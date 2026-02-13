"""Background task runner — dispatches generation tasks to ComfyUI.

支持：
- 批量变体生成（batch_size > 1 时循环执行，每帧随机 seed）
- 单帧重试（最多 3 次）
- partial 状态（部分帧成功）
- 精细进度广播（current_frame / total_frames / frame_progress）
- 透明通道 + ControlNet 工作流
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiohttp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.comfyui_client import (
    COMFYUI_URL,
    build_universal_workflow,
    extract_image_paths,
    queue_prompt,
    wait_for_completion,
)
from app.models import GenerationTask, Style, TrainingJob
from app.progress import ProgressHub

logger = logging.getLogger(__name__)

# Where we copy finished images so the backend can serve them
OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 单帧最大重试次数
MAX_RETRIES = 3


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _clear_gpu_cache() -> None:
    """尝试通过 ComfyUI API 释放显存缓存。"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{COMFYUI_URL}/free",
                json={"unload_models": False, "free_memory": True},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    logger.debug("GPU 缓存已清理")
    except Exception:
        pass  # 非关键操作，忽略错误


# ---------------------------------------------------------------------------
#  Public entry points (fire-and-forget async tasks)
# ---------------------------------------------------------------------------


def run_training_job(
    *,
    session_maker: async_sessionmaker,
    progress_hub: ProgressHub,
    job_id: int,
) -> None:
    asyncio.create_task(
        _training_job_worker(
            session_maker=session_maker,
            progress_hub=progress_hub,
            job_id=job_id,
        )
    )


def run_generation_task(
    *,
    session_maker: async_sessionmaker,
    progress_hub: ProgressHub,
    task_id: int,
) -> None:
    asyncio.create_task(
        _generation_task_worker(
            session_maker=session_maker,
            progress_hub=progress_hub,
            task_id=task_id,
        )
    )


# ---------------------------------------------------------------------------
#  Training worker (still simulated — requires Kohya_ss integration)
# ---------------------------------------------------------------------------


async def _training_job_worker(
    *,
    session_maker: async_sessionmaker,
    progress_hub: ProgressHub,
    job_id: int,
) -> None:
    """Training remains simulated — integrate Kohya_ss later."""
    try:
        async with session_maker() as session:
            result = await session.execute(
                select(TrainingJob).where(TrainingJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if not job:
                return
            job.status = "running"
            await session.commit()

        for p in range(10, 101, 10):
            await asyncio.sleep(1)
            async with session_maker() as session:
                result = await session.execute(
                    select(TrainingJob).where(TrainingJob.id == job_id)
                )
                job = result.scalar_one_or_none()
                if not job:
                    return
                job.progress = float(p)
                if p >= 100:
                    job.status = "completed"
                    # 模拟训练产出路径（真实训练时由 Kohya_ss 输出）
                    job.output_lora_path = f"trained_style_{job.style_id}.safetensors"

                    # ---- 训练完成：更新关联的风格 ----
                    if job.style_id:
                        style_result = await session.execute(
                            select(Style).where(Style.id == job.style_id)
                        )
                        style = style_result.scalar_one_or_none()
                        if style:
                            style.lora_path = job.output_lora_path
                            style.is_trained = True
                            logger.info(
                                "训练完成，已更新风格 %s: lora_path=%s",
                                style.id,
                                style.lora_path,
                            )
                await session.commit()

            await progress_hub.broadcast(
                {
                    "kind": "training",
                    "id": job_id,
                    "progress": float(p),
                    "status": "completed" if p >= 100 else "running",
                    "timestamp": _ts(),
                }
            )
    except Exception as exc:
        logger.exception("Training job %s failed", job_id)
        async with session_maker() as session:
            result = await session.execute(
                select(TrainingJob).where(TrainingJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if job:
                job.status = "failed"
                await session.commit()
        await progress_hub.broadcast(
            {
                "kind": "training",
                "id": job_id,
                "status": "failed",
                "error": str(exc),
                "timestamp": _ts(),
            }
        )


# ---------------------------------------------------------------------------
#  Generation worker — calls real ComfyUI
#  支持批量变体、单帧重试、partial 状态、精细进度
# ---------------------------------------------------------------------------


async def _generation_task_worker(
    *,
    session_maker: async_sessionmaker,
    progress_hub: ProgressHub,
    task_id: int,
) -> None:
    try:
        # ---- 1. 加载任务 & 可选风格 ----
        async with session_maker() as session:
            result = await session.execute(
                select(GenerationTask).where(GenerationTask.id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                return

            lora_name: str | None = None
            checkpoint: str | None = None
            trigger_words: str = ""

            if task.style_id:
                style_result = await session.execute(
                    select(Style).where(Style.id == task.style_id)
                )
                style = style_result.scalar_one_or_none()
                if style:
                    lora_name = style.lora_path or None
                    trigger_words = style.trigger_words or ""

            task.status = "running"
            await session.commit()

            # 提取任务参数（避免跨会话访问 ORM 对象）
            task_type = task.type
            task_prompt = task.prompt
            task_negative_prompt = task.negative_prompt or ""
            task_input_image = task.input_image
            task_seed = task.seed
            task_use_transparency = task.use_transparency
            task_batch_size = task.batch_size or 1
            task_controlnet_config = task.controlnet_config

        # 构建正向提示词（加触发词）
        positive = f"{trigger_words}, {task_prompt}" if trigger_words else task_prompt

        # img2img: 准备参考图
        input_image_name: str | None = None
        if task_type == "img2img" and task_input_image:
            upload_path = Path(__file__).resolve().parent.parent.parent / task_input_image.lstrip("/")
            comfyui_input_dir = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "input"
            comfyui_input_dir.mkdir(parents=True, exist_ok=True)

            if upload_path.exists():
                input_image_name = f"ref_{task_id}_{upload_path.name}"
                dest = comfyui_input_dir / input_image_name
                shutil.copy2(str(upload_path), str(dest))
                logger.info("已复制参考图到 ComfyUI input: %s", input_image_name)

        # ControlNet: 准备控制图
        if task_controlnet_config and task_controlnet_config.get("enabled"):
            cn_image = task_controlnet_config.get("image", "")
            if cn_image:
                # 从 URL 路径提取文件名并复制到 ComfyUI input
                cn_filename = cn_image.split("/")[-1] if "/" in cn_image else cn_image
                cn_upload_path = Path(__file__).resolve().parent.parent.parent / cn_image.lstrip("/")
                comfyui_input_dir = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "input"
                comfyui_input_dir.mkdir(parents=True, exist_ok=True)
                cn_dest = comfyui_input_dir / cn_filename
                if cn_upload_path.exists() and not cn_dest.exists():
                    shutil.copy2(str(cn_upload_path), str(cn_dest))
                    logger.info("已复制 ControlNet 控制图到 ComfyUI input: %s", cn_filename)

        await progress_hub.broadcast(
            {
                "kind": "generation",
                "id": task_id,
                "status": "running",
                "current_frame": 0,
                "total_frames": task_batch_size,
                "frame_progress": 0.0,
                "progress": 0.0,
                "timestamp": _ts(),
            }
        )

        # ---- 2. 批量循环生成 ----
        total = task_batch_size
        success_count = 0
        failed_frames: list[int] = []
        all_served_paths: list[str] = []

        for i in range(total):
            # 每帧随机 seed（用户指定 seed 时仅第一帧使用，后续自增）
            if task_seed is not None:
                frame_seed = task_seed + i
            else:
                frame_seed = random.randint(0, 2**32 - 1)

            frame_success = False
            client_id = str(uuid.uuid4())

            # 重试机制：最多 MAX_RETRIES 次
            for attempt in range(MAX_RETRIES):
                try:
                    # 构建工作流
                    workflow = build_universal_workflow(
                        prompt=positive,
                        negative_prompt=task_negative_prompt,
                        seed=frame_seed,
                        use_transparency=task_use_transparency,
                        controlnet=task_controlnet_config,
                        input_image=input_image_name,
                        lora_name=lora_name,
                        checkpoint=checkpoint,
                    )

                    # 提交到 ComfyUI
                    prompt_id = await queue_prompt(workflow, client_id=client_id)

                    # 等待完成，同时广播帧内进度
                    async def on_progress(pct: float, _frame_idx: int = i) -> None:
                        await progress_hub.broadcast(
                            {
                                "kind": "generation",
                                "id": task_id,
                                "status": "running",
                                "current_frame": _frame_idx + 1,
                                "total_frames": total,
                                "frame_progress": round(pct / 100.0, 2),
                                "progress": round((_frame_idx + pct / 100.0) / total, 3),
                                "timestamp": _ts(),
                            }
                        )

                    history = await wait_for_completion(
                        prompt_id, client_id=client_id, on_progress=on_progress, timeout=300
                    )

                    # 收集输出图片
                    comfy_paths = extract_image_paths(history)
                    for src in comfy_paths:
                        if os.path.exists(src):
                            filename = Path(src).name
                            # 文件命名: {task_id}_{序号}.png
                            out_name = f"{task_id}_{i}.png"
                            dest = OUTPUT_DIR / out_name
                            shutil.copy2(src, str(dest))
                            all_served_paths.append(f"/outputs/{out_name}")

                    if not comfy_paths:
                        raise RuntimeError(f"帧 {i} 未产出图片 (prompt_id={prompt_id})")

                    success_count += 1
                    frame_success = True
                    break  # 成功则跳出重试循环

                except Exception as e:
                    logger.warning(
                        "任务 %s 帧 %d 第 %d 次尝试失败: %s",
                        task_id, i, attempt + 1, e,
                    )
                    if attempt < MAX_RETRIES - 1:
                        await _clear_gpu_cache()
                        await asyncio.sleep(1)
                        continue

            if not frame_success:
                failed_frames.append(i)
                logger.error("任务 %s 帧 %d 在 %d 次重试后仍失败", task_id, i, MAX_RETRIES)

            # 广播帧完成进度
            await progress_hub.broadcast(
                {
                    "kind": "generation",
                    "id": task_id,
                    "status": "running",
                    "current_frame": i + 1,
                    "total_frames": total,
                    "frame_progress": 1.0,
                    "progress": round((i + 1) / total, 3),
                    "timestamp": _ts(),
                }
            )

            # 帧间清理 GPU 缓存
            if i < total - 1:
                await _clear_gpu_cache()

        # ---- 3. 确定最终状态 ----
        if success_count == total:
            final_status = "completed"
        elif success_count > 0:
            final_status = "partial"
        else:
            final_status = "failed"

        # ---- 4. 更新数据库 ----
        async with session_maker() as session:
            result = await session.execute(
                select(GenerationTask).where(GenerationTask.id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                return
            task.status = final_status
            task.output_paths = all_served_paths
            await session.commit()

        # ---- 5. 广播最终状态 ----
        await progress_hub.broadcast(
            {
                "kind": "generation",
                "id": task_id,
                "status": final_status,
                "current_frame": total,
                "total_frames": total,
                "frame_progress": 1.0,
                "progress": 1.0,
                "output_paths": all_served_paths,
                "timestamp": _ts(),
            }
        )

        if failed_frames:
            logger.warning("任务 %s 完成，失败帧: %s", task_id, failed_frames)

    except Exception as exc:
        logger.exception("Generation task %s failed", task_id)
        async with session_maker() as session:
            result = await session.execute(
                select(GenerationTask).where(GenerationTask.id == task_id)
            )
            task = result.scalar_one_or_none()
            if task:
                task.status = "failed"
                await session.commit()
        await progress_hub.broadcast(
            {
                "kind": "generation",
                "id": task_id,
                "status": "failed",
                "error": str(exc),
                "timestamp": _ts(),
            }
        )
