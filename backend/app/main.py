import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.comfyui_client import (
    build_controlnet_preview_workflow,
    check_health as comfy_health_check,
    extract_image_paths,
    queue_prompt,
    wait_for_completion,
)
from app.database import AsyncSessionLocal, engine, get_session, init_db
from app.models import BackgroundRemovalTask, GenerationTask, Style, TrainingJob
from app.progress import ProgressHub
from app.schemas import (
    BackgroundRemovalCreate,
    BackgroundRemovalRead,
    GenerationTaskCreate,
    GenerationTaskRead,
    StyleCreate,
    StyleRead,
    StyleUpdate,
    TaskListItem,
    TrainingJobCreate,
    TrainingJobRead,
)
from app.task_runner import run_generation_task, run_remove_bg_task, run_training_job

logger = logging.getLogger(__name__)

progress_hub = ProgressHub()

# 目录
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR = PROJECT_ROOT / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


async def _migrate_columns() -> None:
    """为已有表添加新列。"""
    migrations: list[tuple[str, str, str]] = [
        ("styles", "is_base", "BOOLEAN NOT NULL DEFAULT 0"),
        ("styles", "is_trained", "BOOLEAN NOT NULL DEFAULT 0"),
        ("generation_tasks", "input_image", "VARCHAR(512)"),
        ("training_jobs", "output_lora_path", "VARCHAR(512)"),
        ("generation_tasks", "negative_prompt", "TEXT DEFAULT ''"),
        ("generation_tasks", "seed", "INTEGER"),
        ("generation_tasks", "batch_size", "INTEGER NOT NULL DEFAULT 1"),
        ("generation_tasks", "controlnet_config", "JSON"),
        # 新增
        ("training_jobs", "training_backend", "VARCHAR(32) DEFAULT 'mflux'"),
    ]
    async with engine.begin() as conn:
        for table, column, definition in migrations:
            result = await conn.execute(text(f"PRAGMA table_info({table})"))
            existing_columns = {row[1] for row in result.fetchall()}
            if column not in existing_columns:
                await conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                )
                logger.info("已迁移: %s.%s", table, column)


async def _init_base_style() -> None:
    """确保系统中存在基础风格（开箱即用，无 LoRA）。"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Style).where(Style.is_base == True)  # noqa: E712
        )
        if not result.scalar_one_or_none():
            base_style = Style(
                name="基础风格",
                type="ui",
                is_base=True,
                is_trained=False,
                # lora_path=None, trigger_words=None, preview_image=None
            )
            session.add(base_style)
            await session.commit()
            logger.info("已创建基础风格")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    await _migrate_columns()
    await _init_base_style()
    yield


app = FastAPI(
    title="Game Asset Generator API",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------- CORS ----------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =====================  API 路由  =====================


@app.get("/health")
async def health() -> dict:
    comfy_ok = await comfy_health_check()
    return {
        "status": "ok",
        "comfyui": "connected" if comfy_ok else "unreachable",
    }


# ---------- 风格管理 ----------


@app.get("/api/styles", response_model=list[StyleRead])
async def list_styles(session: AsyncSession = Depends(get_session)) -> list[Style]:
    result = await session.execute(select(Style).order_by(Style.created_at.desc()))
    return list(result.scalars().all())


@app.post("/api/styles", response_model=StyleRead)
async def create_style(
    payload: StyleCreate, session: AsyncSession = Depends(get_session)
) -> Style:
    item = Style(**payload.model_dump())
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@app.put("/api/styles/{style_id}", response_model=StyleRead)
async def update_style(
    style_id: int,
    payload: StyleUpdate,
    session: AsyncSession = Depends(get_session),
) -> Style:
    result = await session.execute(select(Style).where(Style.id == style_id))
    style = result.scalar_one_or_none()
    if not style:
        raise HTTPException(status_code=404, detail="风格不存在")

    # 部分更新：仅更新非 None 字段
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(style, field, value)

    await session.commit()
    await session.refresh(style)
    return style


@app.delete("/api/styles/{style_id}")
async def delete_style(
    style_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(select(Style).where(Style.id == style_id))
    style = result.scalar_one_or_none()
    if not style:
        raise HTTPException(status_code=404, detail="风格不存在")
    if style.is_base:
        raise HTTPException(status_code=400, detail="不能删除基础风格")

    await session.delete(style)
    await session.commit()
    return {"detail": "已删除"}


# ---------- 训练中心 ----------


@app.post("/api/training", response_model=TrainingJobRead)
async def start_training(
    payload: TrainingJobCreate,
    session: AsyncSession = Depends(get_session),
) -> TrainingJob:
    # 1. 先创建关联的风格（状态：未训练）
    style = Style(
        name=payload.style_name,
        type=payload.style_type,
        is_base=False,
        is_trained=False,
    )
    session.add(style)
    await session.flush()  # 获取 style.id

    # 2. 创建训练任务，关联风格
    job = TrainingJob(
        style_id=style.id,
        dataset_path=payload.dataset_path,
        params=payload.params,
        status="queued",
        progress=0.0,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    run_training_job(
        session_maker=AsyncSessionLocal,
        progress_hub=progress_hub,
        job_id=job.id,
    )
    return job


@app.get("/api/training/{job_id}", response_model=TrainingJobRead)
async def get_training_job(
    job_id: int, session: AsyncSession = Depends(get_session)
) -> TrainingJob:
    result = await session.execute(
        select(TrainingJob).where(TrainingJob.id == job_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="training job not found")
    return job


# ---------- 文件上传 ----------

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


@app.post("/api/upload")
async def upload_image(file: UploadFile) -> dict:
    """上传参考图片，返回可访问的 URL 路径。"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名为空")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}，支持 {', '.join(ALLOWED_EXTENSIONS)}",
        )

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="文件大小超过 10MB 限制")

    # 生成唯一文件名，避免冲突
    unique_name = f"{uuid.uuid4().hex[:12]}{ext}"
    dest = UPLOADS_DIR / unique_name
    dest.write_bytes(content)

    url_path = f"/uploads/{unique_name}"
    logger.info("已上传文件: %s -> %s", file.filename, url_path)
    return {"url": url_path, "filename": unique_name}


# ---------- 生成中心 ----------


@app.post("/api/generate", response_model=GenerationTaskRead)
async def generate(
    payload: GenerationTaskCreate,
    session: AsyncSession = Depends(get_session),
) -> GenerationTask:
    # 将 controlnet 配置转为 JSON 字段存储
    task_data = payload.model_dump(exclude={"controlnet"})
    task_data["controlnet_config"] = payload.controlnet.model_dump() if payload.controlnet else None
    task_data["status"] = "queued"
    task_data["output_paths"] = []

    task = GenerationTask(**task_data)
    session.add(task)
    await session.commit()
    await session.refresh(task)

    run_generation_task(
        session_maker=AsyncSessionLocal,
        progress_hub=progress_hub,
        task_id=task.id,
    )
    return task


# ---------- 抠图中心 ----------


@app.post("/api/remove-bg", response_model=BackgroundRemovalRead)
async def remove_background(
    payload: BackgroundRemovalCreate,
    session: AsyncSession = Depends(get_session),
) -> BackgroundRemovalTask:
    task = BackgroundRemovalTask(
        input_image=payload.input_image,
        model=payload.model,
        source_task_id=payload.source_task_id,
        status="queued",
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)

    run_remove_bg_task(
        session_maker=AsyncSessionLocal,
        progress_hub=progress_hub,
        task_id=task.id,
    )
    return task


@app.get("/api/remove-bg/{task_id}", response_model=BackgroundRemovalRead)
async def get_remove_bg_task(
    task_id: int,
    session: AsyncSession = Depends(get_session),
) -> BackgroundRemovalTask:
    result = await session.execute(
        select(BackgroundRemovalTask).where(BackgroundRemovalTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="抠图任务不存在")
    return task


# ---------- ControlNet 预处理预览 ----------


@app.post("/api/controlnet/preview")
async def controlnet_preview(
    image: UploadFile,
    control_type: str = Form(...),
) -> dict:
    """接收原图 + 控制类型，调用 ComfyUI 预处理器节点，返回预处理后的预览图。"""
    valid_types = {"canny", "depth", "tile", "blur", "pose"}
    if control_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的控制类型: {control_type}，支持 {', '.join(valid_types)}",
        )

    if not image.filename:
        raise HTTPException(status_code=400, detail="文件名为空")

    # 保存上传图片到 uploads/
    content = await image.read()
    ext = Path(image.filename).suffix.lower()
    unique_name = f"ctrl_{uuid.uuid4().hex[:12]}{ext}"
    dest = UPLOADS_DIR / unique_name
    dest.write_bytes(content)

    # 复制到 ComfyUI input 目录
    import shutil
    comfyui_input_dir = PROJECT_ROOT / "ComfyUI" / "input"
    comfyui_input_dir.mkdir(parents=True, exist_ok=True)
    comfyui_dest = comfyui_input_dir / unique_name
    shutil.copy2(str(dest), str(comfyui_dest))

    # 构建预处理预览工作流
    workflow = build_controlnet_preview_workflow(
        image_name=unique_name,
        control_type=control_type,
    )

    try:
        prompt_id = await queue_prompt(workflow)
        history = await wait_for_completion(prompt_id, timeout=60)
        image_paths = extract_image_paths(history)

        if not image_paths:
            raise RuntimeError("预处理未产出结果图片")

        # 复制预览图到 outputs/
        import os
        served_paths: list[str] = []
        for src in image_paths:
            if os.path.exists(src):
                filename = Path(src).name
                out_dest = OUTPUTS_DIR / f"preview_{unique_name}_{filename}"
                shutil.copy2(src, str(out_dest))
                served_paths.append(f"/outputs/{out_dest.name}")

        return {"preview_url": served_paths[0] if served_paths else None}

    except Exception as exc:
        logger.exception("ControlNet 预处理预览失败")
        raise HTTPException(status_code=500, detail=f"预处理预览失败: {exc}") from exc


# ---------- 任务详情 ----------


@app.get("/api/tasks/{task_id}", response_model=GenerationTaskRead)
async def get_task(
    task_id: int,
    session: AsyncSession = Depends(get_session),
) -> GenerationTask:
    """返回单个生成任务详情"""
    result = await session.execute(
        select(GenerationTask).where(GenerationTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


# ---------- 任务列表 ----------


@app.get("/api/tasks", response_model=list[TaskListItem])
async def list_tasks(
    session: AsyncSession = Depends(get_session),
) -> list[TaskListItem]:
    training_result = await session.execute(select(TrainingJob))
    generation_result = await session.execute(select(GenerationTask))
    rmbg_result = await session.execute(select(BackgroundRemovalTask))

    training_items = [
        TaskListItem(
            id=i.id,
            task_kind="training",
            status=i.status,
            created_at=i.created_at,
            progress=i.progress,
        )
        for i in training_result.scalars().all()
    ]
    generation_items = [
        TaskListItem(
            id=i.id,
            task_kind="generation",
            status=i.status,
            created_at=i.created_at,
            output_paths=i.output_paths,
        )
        for i in generation_result.scalars().all()
    ]
    rmbg_items = [
        TaskListItem(
            id=i.id,
            task_kind="remove_bg",
            status=i.status,
            created_at=i.created_at,
            output_paths=[i.output_image] if i.output_image else [],
        )
        for i in rmbg_result.scalars().all()
    ]
    merged = training_items + generation_items + rmbg_items
    merged.sort(key=lambda x: x.created_at, reverse=True)
    return merged


# ---------- WebSocket 实时进度 ----------


@app.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket) -> None:
    await progress_hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await progress_hub.disconnect(websocket)
    except Exception:
        await progress_hub.disconnect(websocket)


# =====================  静态文件托管  =====================

# React 构建产物目录 (frontend/dist)
FRONTEND_DIST_DIR = FRONTEND_DIR / "dist"


@app.get("/")
async def serve_index():
    """Serve the frontend index.html (React SPA entry)."""
    # 优先使用 React 构建产物
    dist_index = FRONTEND_DIST_DIR / "index.html"
    if dist_index.exists():
        return FileResponse(str(dist_index))
    # 回退到旧版 frontend/index.html
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"detail": "frontend not found, run 'npm run build' in frontend/"}


# 输出图片静态目录
if OUTPUTS_DIR.exists():
    app.mount(
        "/outputs",
        StaticFiles(directory=str(OUTPUTS_DIR)),
        name="outputs-static",
    )

# 上传文件静态目录
if UPLOADS_DIR.exists():
    app.mount(
        "/uploads",
        StaticFiles(directory=str(UPLOADS_DIR)),
        name="uploads-static",
    )

# React 构建产物静态资源 (CSS, JS, images)
if FRONTEND_DIST_DIR.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST_DIR / "assets")),
        name="frontend-assets",
    )

# 前端静态目录（兼容旧版）
if FRONTEND_DIR.exists():
    app.mount(
        "/static",
        StaticFiles(directory=str(FRONTEND_DIR)),
        name="frontend-static",
    )
