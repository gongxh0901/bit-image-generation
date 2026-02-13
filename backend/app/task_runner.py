"""Background task runner — dispatches generation/training/remove-bg tasks.

支持：
- Flux.1 Schnell 生成（txt2img / img2img）
- 批量变体生成（batch_size > 1 时循环执行，每帧随机 seed）
- 单帧重试（最多 3 次）
- partial 状态（部分帧成功）
- BiRefNet 背景移除
- MFlux LoRA 训练
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
    build_flux_workflow,
    build_remove_bg_workflow,
    extract_image_paths,
    queue_prompt,
    wait_for_completion,
)
from app.models import BackgroundRemovalTask, GenerationTask, Style, TrainingJob
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
        pass


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


def run_remove_bg_task(
    *,
    session_maker: async_sessionmaker,
    progress_hub: ProgressHub,
    task_id: int,
) -> None:
    asyncio.create_task(
        _remove_bg_worker(
            session_maker=session_maker,
            progress_hub=progress_hub,
            task_id=task_id,
        )
    )


# ---------------------------------------------------------------------------
#  Training worker — calls MFlux CLI
# ---------------------------------------------------------------------------


async def _training_job_worker(
    *,
    session_maker: async_sessionmaker,
    progress_hub: ProgressHub,
    job_id: int,
) -> None:
    """MFlux LoRA 训练 worker。

    通过 asyncio.create_subprocess_exec 调用 mflux-train CLI，
    解析日志输出推送训练进度。
    训练完成后自动将 LoRA 文件复制到 ComfyUI/models/loras/ 目录。
    """
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

            # 提取训练参数
            params = job.params or {}
            dataset_path = job.dataset_path
            style_id = job.style_id

        # MFlux 训练输出目录
        output_dir = OUTPUT_DIR / f"training_{job_id}"
        output_dir.mkdir(parents=True, exist_ok=True)

        lora_rank = params.get("lora_rank", 16)
        learning_rate = params.get("learning_rate", 1e-4)
        steps = params.get("steps", 1000)

        # 调用 MFlux CLI
        cmd = [
            "mflux-train",
            "--model", "flux.1-schnell",
            "--dataset-path", dataset_path,
            "--output-dir", str(output_dir),
            "--lora-rank", str(lora_rank),
            "--learning-rate", str(learning_rate),
            "--steps", str(steps),
        ]

        logger.info("启动 MFlux 训练: %s", " ".join(cmd))

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        # 读取输出，解析进度
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode().strip()
            logger.debug("[MFlux] %s", text)

            # 尝试解析进度（MFlux 输出格式：Step X/Y）
            if "Step " in text and "/" in text:
                try:
                    parts = text.split("Step ")[1].split("/")
                    current_step = int(parts[0].strip())
                    total_steps = int(parts[1].split()[0].strip())
                    progress = current_step / total_steps * 100
                    await progress_hub.broadcast({
                        "kind": "training",
                        "id": job_id,
                        "progress": round(progress, 1),
                        "status": "running",
                        "timestamp": _ts(),
                    })
                except (IndexError, ValueError):
                    pass

        await proc.wait()

        if proc.returncode == 0:
            # 查找输出的 LoRA 文件
            lora_files = list(output_dir.glob("*.safetensors"))
            output_lora_path: str | None = None

            if lora_files:
                # 复制到 ComfyUI/models/loras/
                comfyui_loras = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "models" / "loras"
                comfyui_loras.mkdir(parents=True, exist_ok=True)
                lora_file = lora_files[0]
                dest_name = f"trained_style_{style_id}.safetensors"
                dest = comfyui_loras / dest_name
                shutil.copy2(str(lora_file), str(dest))
                output_lora_path = dest_name
                logger.info("LoRA 已复制到: %s", dest)

            async with session_maker() as session:
                result = await session.execute(
                    select(TrainingJob).where(TrainingJob.id == job_id)
                )
                job = result.scalar_one_or_none()
                if job:
                    job.status = "completed"
                    job.progress = 100.0
                    job.output_lora_path = output_lora_path

                    if style_id:
                        style_result = await session.execute(
                            select(Style).where(Style.id == style_id)
                        )
                        style = style_result.scalar_one_or_none()
                        if style and output_lora_path:
                            style.lora_path = output_lora_path
                            style.is_trained = True
                    await session.commit()

            await progress_hub.broadcast({
                "kind": "training",
                "id": job_id,
                "progress": 100.0,
                "status": "completed",
                "timestamp": _ts(),
            })
        else:
            raise RuntimeError(f"MFlux 训练失败，退出码: {proc.returncode}")

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
        await progress_hub.broadcast({
            "kind": "training",
            "id": job_id,
            "status": "failed",
            "error": str(exc),
            "timestamp": _ts(),
        })


# ---------------------------------------------------------------------------
#  Generation worker — calls real ComfyUI with Flux.1 Schnell
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

            # 提取任务参数
            task_type = task.type
            task_prompt = task.prompt
            task_negative_prompt = task.negative_prompt or ""
            task_input_image = task.input_image
            task_seed = task.seed
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
                cn_filename = cn_image.split("/")[-1] if "/" in cn_image else cn_image
                cn_upload_path = Path(__file__).resolve().parent.parent.parent / cn_image.lstrip("/")
                comfyui_input_dir = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "input"
                comfyui_input_dir.mkdir(parents=True, exist_ok=True)
                cn_dest = comfyui_input_dir / cn_filename
                if cn_upload_path.exists() and not cn_dest.exists():
                    shutil.copy2(str(cn_upload_path), str(cn_dest))
                    logger.info("已复制 ControlNet 控制图到 ComfyUI input: %s", cn_filename)

        await progress_hub.broadcast({
            "kind": "generation",
            "id": task_id,
            "status": "running",
            "current_frame": 0,
            "total_frames": task_batch_size,
            "frame_progress": 0.0,
            "progress": 0.0,
            "timestamp": _ts(),
        })

        # ---- 2. 批量循环生成 ----
        total = task_batch_size
        success_count = 0
        failed_frames: list[int] = []
        all_served_paths: list[str] = []

        for i in range(total):
            if task_seed is not None:
                frame_seed = task_seed + i
            else:
                frame_seed = random.randint(0, 2**32 - 1)

            frame_success = False
            client_id = str(uuid.uuid4())

            for attempt in range(MAX_RETRIES):
                try:
                    workflow = build_flux_workflow(
                        prompt=positive,
                        negative_prompt=task_negative_prompt,
                        seed=frame_seed,
                        controlnet=task_controlnet_config,
                        input_image=input_image_name,
                        lora_name=lora_name,
                    )

                    prompt_id = await queue_prompt(workflow, client_id=client_id)

                    async def on_progress(pct: float, _frame_idx: int = i) -> None:
                        await progress_hub.broadcast({
                            "kind": "generation",
                            "id": task_id,
                            "status": "running",
                            "current_frame": _frame_idx + 1,
                            "total_frames": total,
                            "frame_progress": round(pct / 100.0, 2),
                            "progress": round((_frame_idx + pct / 100.0) / total, 3),
                            "timestamp": _ts(),
                        })

                    history = await wait_for_completion(
                        prompt_id, client_id=client_id, on_progress=on_progress, timeout=300
                    )

                    comfy_paths = extract_image_paths(history)
                    for src in comfy_paths:
                        if os.path.exists(src):
                            out_name = f"{task_id}_{i}.png"
                            dest = OUTPUT_DIR / out_name
                            shutil.copy2(src, str(dest))
                            all_served_paths.append(f"/outputs/{out_name}")

                    if not comfy_paths:
                        raise RuntimeError(f"帧 {i} 未产出图片 (prompt_id={prompt_id})")

                    success_count += 1
                    frame_success = True
                    break

                except Exception as e:
                    logger.warning("任务 %s 帧 %d 第 %d 次尝试失败: %s", task_id, i, attempt + 1, e)
                    if attempt < MAX_RETRIES - 1:
                        await _clear_gpu_cache()
                        await asyncio.sleep(1)

            if not frame_success:
                failed_frames.append(i)
                logger.error("任务 %s 帧 %d 在 %d 次重试后仍失败", task_id, i, MAX_RETRIES)

            await progress_hub.broadcast({
                "kind": "generation",
                "id": task_id,
                "status": "running",
                "current_frame": i + 1,
                "total_frames": total,
                "frame_progress": 1.0,
                "progress": round((i + 1) / total, 3),
                "timestamp": _ts(),
            })

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
        await progress_hub.broadcast({
            "kind": "generation",
            "id": task_id,
            "status": final_status,
            "current_frame": total,
            "total_frames": total,
            "frame_progress": 1.0,
            "progress": 1.0,
            "output_paths": all_served_paths,
            "timestamp": _ts(),
        })

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
        await progress_hub.broadcast({
            "kind": "generation",
            "id": task_id,
            "status": "failed",
            "error": str(exc),
            "timestamp": _ts(),
        })


# ---------------------------------------------------------------------------
#  Background removal worker — calls ComfyUI with BiRefNet
# ---------------------------------------------------------------------------


async def _remove_bg_worker(
    *,
    session_maker: async_sessionmaker,
    progress_hub: ProgressHub,
    task_id: int,
) -> None:
    """BiRefNet 背景移除 worker。"""
    try:
        async with session_maker() as session:
            result = await session.execute(
                select(BackgroundRemovalTask).where(BackgroundRemovalTask.id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                return
            task.status = "running"
            await session.commit()
            input_image = task.input_image

        await progress_hub.broadcast({
            "kind": "remove_bg",
            "id": task_id,
            "status": "running",
            "progress": 0.0,
            "timestamp": _ts(),
        })

        # 准备图片到 ComfyUI input 目录
        upload_path = Path(__file__).resolve().parent.parent.parent / input_image.lstrip("/")
        comfyui_input_dir = Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "input"
        comfyui_input_dir.mkdir(parents=True, exist_ok=True)

        image_name = f"rmbg_{task_id}_{upload_path.name}"
        dest = comfyui_input_dir / image_name
        shutil.copy2(str(upload_path), str(dest))

        # 构建并执行工作流
        workflow = build_remove_bg_workflow(image_name=image_name)
        client_id = str(uuid.uuid4())
        prompt_id = await queue_prompt(workflow, client_id=client_id)

        async def on_progress(pct: float) -> None:
            await progress_hub.broadcast({
                "kind": "remove_bg",
                "id": task_id,
                "status": "running",
                "progress": round(pct / 100.0, 2),
                "timestamp": _ts(),
            })

        history = await wait_for_completion(
            prompt_id, client_id=client_id, on_progress=on_progress, timeout=120
        )

        comfy_paths = extract_image_paths(history)
        if not comfy_paths:
            raise RuntimeError("BiRefNet 未产出结果图片")

        # 复制到 outputs/
        src = comfy_paths[0]
        out_name = f"rmbg_{task_id}.png"
        out_path = OUTPUT_DIR / out_name
        if os.path.exists(src):
            shutil.copy2(src, str(out_path))

        served_path = f"/outputs/{out_name}"

        # 更新数据库
        async with session_maker() as session:
            result = await session.execute(
                select(BackgroundRemovalTask).where(BackgroundRemovalTask.id == task_id)
            )
            task = result.scalar_one_or_none()
            if task:
                task.status = "completed"
                task.output_image = served_path
                task.completed_at = datetime.now(timezone.utc)
                await session.commit()

        await progress_hub.broadcast({
            "kind": "remove_bg",
            "id": task_id,
            "status": "completed",
            "progress": 1.0,
            "output_paths": [served_path],
            "timestamp": _ts(),
        })

    except Exception as exc:
        logger.exception("Remove-bg task %s failed", task_id)
        async with session_maker() as session:
            result = await session.execute(
                select(BackgroundRemovalTask).where(BackgroundRemovalTask.id == task_id)
            )
            task = result.scalar_one_or_none()
            if task:
                task.status = "failed"
                await session.commit()
        await progress_hub.broadcast({
            "kind": "remove_bg",
            "id": task_id,
            "status": "failed",
            "error": str(exc),
            "timestamp": _ts(),
        })
