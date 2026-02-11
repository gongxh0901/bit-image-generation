from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.comfyui_client import check_health as comfy_health_check
from app.database import AsyncSessionLocal, get_session, init_db
from app.models import GenerationTask, Style, TrainingJob
from app.progress import ProgressHub
from app.schemas import (
    GenerationTaskCreate,
    GenerationTaskRead,
    StyleCreate,
    StyleRead,
    TaskListItem,
    TrainingJobCreate,
    TrainingJobRead,
)
from app.task_runner import run_generation_task, run_training_job


progress_hub = ProgressHub()

# 目录
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
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


# ---------- 训练中心 ----------


@app.post("/api/training", response_model=TrainingJobRead)
async def start_training(
    payload: TrainingJobCreate,
    session: AsyncSession = Depends(get_session),
) -> TrainingJob:
    job = TrainingJob(**payload.model_dump(), status="queued", progress=0.0)
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


# ---------- 生成中心 ----------


@app.post("/api/generate", response_model=GenerationTaskRead)
async def generate(
    payload: GenerationTaskCreate,
    session: AsyncSession = Depends(get_session),
) -> GenerationTask:
    task = GenerationTask(**payload.model_dump(), status="queued", output_paths=[])
    session.add(task)
    await session.commit()
    await session.refresh(task)

    run_generation_task(
        session_maker=AsyncSessionLocal,
        progress_hub=progress_hub,
        task_id=task.id,
    )
    return task


# ---------- 任务列表 ----------


@app.get("/api/tasks", response_model=list[TaskListItem])
async def list_tasks(
    session: AsyncSession = Depends(get_session),
) -> list[TaskListItem]:
    training_result = await session.execute(select(TrainingJob))
    generation_result = await session.execute(select(GenerationTask))

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
    merged = training_items + generation_items
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


@app.get("/")
async def serve_index():
    """Serve the frontend index.html at root."""
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"detail": "frontend not found, place index.html in ../frontend/"}


# 输出图片静态目录
if OUTPUTS_DIR.exists():
    app.mount(
        "/outputs",
        StaticFiles(directory=str(OUTPUTS_DIR)),
        name="outputs-static",
    )

# 前端静态目录
if FRONTEND_DIR.exists():
    app.mount(
        "/static",
        StaticFiles(directory=str(FRONTEND_DIR)),
        name="frontend-static",
    )
