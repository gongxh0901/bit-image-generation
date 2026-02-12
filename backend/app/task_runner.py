"""Background task runner — dispatches generation tasks to ComfyUI."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.comfyui_client import (
    build_img2img_prompt,
    build_txt2img_prompt,
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


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


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
# ---------------------------------------------------------------------------


async def _generation_task_worker(
    *,
    session_maker: async_sessionmaker,
    progress_hub: ProgressHub,
    task_id: int,
) -> None:
    try:
        # ---- Load task & optional style ----
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
                    # If lora_path looks like a checkpoint, use it that way
                    # otherwise it's a LoRA file

            task.status = "running"
            await session.commit()

            task_type = task.type
            task_prompt = task.prompt
            task_input_image = task.input_image

        await progress_hub.broadcast(
            {
                "kind": "generation",
                "id": task_id,
                "status": "running",
                "progress": 0.0,
                "timestamp": _ts(),
            }
        )

        # ---- Build workflow ----
        positive = f"{trigger_words}, {task_prompt}" if trigger_words else task_prompt

        client_id = str(uuid.uuid4())

        if task_type == "img2img":
            # 将上传的图片复制到 ComfyUI input 目录
            input_image_name = "input.png"  # 回退默认值
            if task_input_image:
                # task_input_image 是 URL 路径如 /uploads/xxxx.png
                upload_path = Path(__file__).resolve().parent.parent.parent / task_input_image.lstrip("/")
                comfyui_input_dir = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "input"
                comfyui_input_dir.mkdir(parents=True, exist_ok=True)

                if upload_path.exists():
                    input_image_name = f"ref_{task_id}_{upload_path.name}"
                    dest = comfyui_input_dir / input_image_name
                    shutil.copy2(str(upload_path), str(dest))
                    logger.info("已复制参考图到 ComfyUI input: %s", input_image_name)

            workflow = build_img2img_prompt(
                positive_prompt=positive,
                input_image=input_image_name,
                lora_name=lora_name,
                checkpoint=checkpoint,
            )
        else:
            workflow = build_txt2img_prompt(
                positive_prompt=positive,
                lora_name=lora_name,
                checkpoint=checkpoint,
            )

        # ---- Submit to ComfyUI ----
        prompt_id = await queue_prompt(workflow, client_id=client_id)

        # ---- Wait with progress callback ----
        async def on_progress(pct: float) -> None:
            await progress_hub.broadcast(
                {
                    "kind": "generation",
                    "id": task_id,
                    "status": "running",
                    "progress": round(pct, 1),
                    "timestamp": _ts(),
                }
            )

        history = await wait_for_completion(
            prompt_id, client_id=client_id, on_progress=on_progress, timeout=300
        )

        # ---- Collect output images ----
        comfy_paths = extract_image_paths(history)
        served_paths: list[str] = []

        for src in comfy_paths:
            if os.path.exists(src):
                filename = Path(src).name
                dest = OUTPUT_DIR / f"task_{task_id}_{filename}"
                shutil.copy2(src, dest)
                # Store a relative URL path so frontend can fetch it
                served_paths.append(f"/outputs/{dest.name}")

        if not served_paths:
            raise RuntimeError(
                f"ComfyUI did not produce output images for prompt {prompt_id}"
            )

        # ---- Mark complete ----
        async with session_maker() as session:
            result = await session.execute(
                select(GenerationTask).where(GenerationTask.id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                return
            task.status = "completed"
            task.output_paths = served_paths
            await session.commit()

        await progress_hub.broadcast(
            {
                "kind": "generation",
                "id": task_id,
                "status": "completed",
                "progress": 100.0,
                "output_paths": served_paths,
                "timestamp": _ts(),
            }
        )

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
