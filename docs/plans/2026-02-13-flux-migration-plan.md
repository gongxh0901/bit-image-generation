# Flux.1 Schnell 迁移实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将项目从 SDXL + LayerDiffusion 迁移到 Flux.1 Schnell + BiRefNet，全面重构前后端。

**Architecture:** 后端重写 ComfyUI 工作流构建器（Flux.1 Schnell GGUF）、新增 BiRefNet 抠图 API、LoRA 训练改用 MFlux CLI。前端移除透明通道 UI、新增抠图页面、更新 ControlNet 为 Union 模式。

**Tech Stack:** FastAPI, SQLAlchemy (SQLite), ComfyUI + ComfyUI-GGUF, Flux.1 Schnell, BiRefNet, MFlux, React 19, TypeScript, Ant Design 6, Zustand 5

---

## 阶段一：后端核心重构

### Task 1: 更新数据库模型

**Files:**
- Modify: `backend/app/models.py`

**Step 1: 修改 GenerationTask 模型 — 移除 use_transparency**

在 `backend/app/models.py:54` 删除 `use_transparency` 字段。

```python
# 删除这一行：
use_transparency: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="1")
```

**Step 2: 新增 BackgroundRemovalTask 模型**

在 `backend/app/models.py` 末尾（Dataset 类之后）添加：

```python
class BackgroundRemovalTask(Base):
    __tablename__ = "background_removal_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    input_image: Mapped[str] = mapped_column(String(512), nullable=False)
    output_image: Mapped[str | None] = mapped_column(String(512), nullable=True)
    model: Mapped[str] = mapped_column(String(64), default="birefnet", server_default="birefnet")
    status: Mapped[str] = mapped_column(String(32), default="queued")
    source_task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

**Step 3: 修改 TrainingJob 模型 — 添加 training_backend 字段**

在 `backend/app/models.py` TrainingJob 类中，`output_lora_path` 之后添加：

```python
training_backend: Mapped[str] = mapped_column(String(32), default="mflux", server_default="mflux")
```

**Step 4: 验证**

Run: `cd /Users/gongxh/AI/bit-image-generation/backend && source .venv/bin/activate && python -c "from app.models import *; print('Models OK')"`

**Step 5: Commit**

```bash
git add backend/app/models.py
git commit -m "refactor: 更新数据库模型 — 移除 use_transparency，新增 BackgroundRemovalTask"
```

---

### Task 2: 更新 Pydantic Schema

**Files:**
- Modify: `backend/app/schemas.py`

**Step 1: 更新 ControlNetConfig — 改为 Flux.1 Union 类型**

修改 `backend/app/schemas.py:13`：

```python
class ControlNetConfig(BaseModel):
    """ControlNet 配置（Flux.1 ControlNet Union）"""
    enabled: bool = False
    type: Literal["canny", "depth", "tile", "blur", "pose"] = "canny"
    image: str | None = None
    strength: float = Field(default=1.0, ge=0.0, le=2.0)
```

**Step 2: 更新 GenerationTaskCreate — 移除 use_transparency**

修改 `backend/app/schemas.py:74-84`，删除 `use_transparency` 字段：

```python
class GenerationTaskCreate(BaseModel):
    style_id: int | None = None
    type: Literal["txt2img", "img2img"]
    prompt: str
    negative_prompt: str = "ugly, blurry, low quality, watermark, text"
    input_image: str | None = None
    seed: int | None = None
    batch_size: int = Field(default=1, ge=1, le=32)
    controlnet: ControlNetConfig | None = None
```

**Step 3: 更新 GenerationTaskRead — 移除 use_transparency**

修改 `backend/app/schemas.py:87-103`，删除 `use_transparency` 字段：

```python
class GenerationTaskRead(BaseModel):
    id: int
    style_id: int | None
    type: str
    prompt: str
    negative_prompt: str
    input_image: str | None
    seed: int | None
    batch_size: int
    controlnet_config: dict | None
    status: str
    output_paths: list[str]
    created_at: datetime

    class Config:
        from_attributes = True
```

**Step 4: 新增 BackgroundRemoval Schema**

在 `backend/app/schemas.py` 末尾添加：

```python
class BackgroundRemovalCreate(BaseModel):
    input_image: str
    model: Literal["birefnet", "birefnet-hr"] = "birefnet"
    source_task_id: int | None = None


class BackgroundRemovalRead(BaseModel):
    id: int
    input_image: str
    output_image: str | None
    model: str
    status: str
    source_task_id: int | None
    created_at: datetime
    completed_at: datetime | None

    class Config:
        from_attributes = True
```

**Step 5: 更新 TaskListItem — 添加 remove_bg 类型**

修改 `backend/app/schemas.py` TaskListItem：

```python
class TaskListItem(BaseModel):
    id: int
    task_kind: Literal["training", "generation", "remove_bg"]
    status: str
    created_at: datetime
    progress: float | None = None
    output_paths: list[str] | None = None
```

**Step 6: 更新 TrainingJobCreate — 添加 MFlux 参数**

修改 `backend/app/schemas.py` TrainingJobCreate：

```python
class TrainingJobCreate(BaseModel):
    style_name: str
    style_type: Literal["ui", "vfx"] = "ui"
    dataset_path: str
    params: dict[str, Any] = Field(default_factory=lambda: {
        "lora_rank": 16,
        "learning_rate": 1e-4,
        "steps": 1000,
    })
```

**Step 7: Commit**

```bash
git add backend/app/schemas.py
git commit -m "refactor: 更新 Pydantic schema — 移除 use_transparency，新增抠图 schema"
```

---

### Task 3: 重写 ComfyUI 工作流构建器

**Files:**
- Rewrite: `backend/app/comfyui_client.py`
- Delete: `backend/app/workflows/txt2img_sdxl_lightning.json`
- Delete: `backend/app/workflows/img2img_sdxl_lightning.json`

**Step 1: 重写 comfyui_client.py**

完整替换 `backend/app/comfyui_client.py`：

```python
"""ComfyUI REST/WebSocket client.

Talks to the ComfyUI server (default http://127.0.0.1:8188) to:
- Queue a workflow (prompt)
- Track progress via WebSocket
- Retrieve finished images

动态构建工作流，支持：
- Flux.1 Schnell (GGUF 量化模型)
- ControlNet Union (InstantX)
- BiRefNet 背景移除
- txt2img / img2img
- 批量生成（每帧独立调用）
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import uuid
from pathlib import Path
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)

COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188")
COMFYUI_OUTPUT_DIR = os.getenv(
    "COMFYUI_OUTPUT_DIR",
    str(Path(__file__).resolve().parent.parent.parent / "ComfyUI" / "output"),
)

# ---------------------------------------------------------------------------
#  Flux.1 Schnell 默认模型路径
# ---------------------------------------------------------------------------

FLUX_UNET = os.getenv("FLUX_UNET", "flux1-schnell-Q5_K_S.gguf")
FLUX_CLIP_L = os.getenv("FLUX_CLIP_L", "clip_l.safetensors")
FLUX_T5XXL = os.getenv("FLUX_T5XXL", "t5xxl_fp16.safetensors")
FLUX_VAE = os.getenv("FLUX_VAE", "ae.safetensors")
FLUX_CONTROLNET = os.getenv("FLUX_CONTROLNET", "instantx-flux-union-controlnet.safetensors")

# ---------------------------------------------------------------------------
#  ControlNet Union 类型映射（Flux.1 ControlNet Union）
# ---------------------------------------------------------------------------

CONTROLNET_UNION_TYPE_MAP: dict[str, int] = {
    "canny": 0,
    "tile": 1,
    "depth": 2,
    "blur": 3,
    "pose": 4,
}

# 对应预处理器节点名
CONTROLNET_PREPROCESSOR_MAP: dict[str, str] = {
    "canny": "CannyEdgePreprocessor",
    "depth": "DepthAnythingV2Preprocessor",
    "tile": "TilePreprocessor",
    "blur": "BlurPreprocessor",
    "pose": "DWPreprocessor",
}


# ---------------------------------------------------------------------------
#  节点 ID 计数器
# ---------------------------------------------------------------------------

class _NodeIdCounter:
    """节点 ID 计数器"""
    def __init__(self) -> None:
        self._id = 0

    def next(self) -> str:
        self._id += 1
        return str(self._id)


# ---------------------------------------------------------------------------
#  Flux.1 Schnell 工作流构建
# ---------------------------------------------------------------------------

def build_flux_workflow(
    *,
    prompt: str,
    negative_prompt: str = "",
    seed: int,
    controlnet: dict | None = None,
    input_image: str | None = None,
    lora_name: str | None = None,
    width: int = 1024,
    height: int = 1024,
    denoise: float = 0.6,
) -> dict:
    """动态构建 Flux.1 Schnell ComfyUI workflow dict。

    根据参数条件注入节点：
    - lora_name → 注入 LoraLoader 节点
    - controlnet.enabled=True → 注入 ControlNet Union 节点
    - input_image → img2img 模式（LoadImage + VAEEncode）
    """
    workflow: dict[str, dict] = {}
    nid = _NodeIdCounter()

    # ===================== 1. 模型加载（GGUF） =====================

    unet_id = nid.next()
    workflow[unet_id] = {
        "class_type": "UnetLoaderGGUF",
        "inputs": {"unet_name": FLUX_UNET},
    }
    model_out = [unet_id, 0]

    # ===================== 2. CLIP 加载（双编码器） =====================

    clip_id = nid.next()
    workflow[clip_id] = {
        "class_type": "DualCLIPLoaderGGUF",
        "inputs": {
            "clip_name1": FLUX_CLIP_L,
            "clip_name2": FLUX_T5XXL,
            "type": "flux",
        },
    }
    clip_out = [clip_id, 0]

    # ===================== 3. VAE 加载 =====================

    vae_id = nid.next()
    workflow[vae_id] = {
        "class_type": "VAELoader",
        "inputs": {"vae_name": FLUX_VAE},
    }
    vae_out = [vae_id, 0]

    # ===================== 4. LoRA（可选） =====================

    if lora_name:
        lora_name_clean = Path(lora_name).name
        lora_id = nid.next()
        workflow[lora_id] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": lora_name_clean,
                "strength_model": 1.0,
                "strength_clip": 1.0,
                "model": model_out,
                "clip": clip_out,
            },
        }
        model_out = [lora_id, 0]
        clip_out = [lora_id, 1]

    # ===================== 5. 文本编码 =====================

    # Flux 使用 CLIPTextEncodeFlux 节点
    pos_clip_id = nid.next()
    workflow[pos_clip_id] = {
        "class_type": "CLIPTextEncodeFlux",
        "inputs": {
            "clip_l": prompt,
            "t5xxl": prompt,
            "guidance": 3.5,
            "clip": clip_out,
        },
    }
    positive_cond = [pos_clip_id, 0]

    # Flux Schnell 不使用 negative prompt，但需要空 conditioning
    neg_clip_id = nid.next()
    workflow[neg_clip_id] = {
        "class_type": "CLIPTextEncodeFlux",
        "inputs": {
            "clip_l": "",
            "t5xxl": "",
            "guidance": 3.5,
            "clip": clip_out,
        },
    }
    negative_cond = [neg_clip_id, 0]

    # ===================== 6. ControlNet（可选） =====================

    if controlnet and controlnet.get("enabled"):
        cn_type = controlnet.get("type", "canny")
        cn_image = controlnet.get("image", "")
        cn_strength = controlnet.get("strength", 1.0)

        # 从 URL 路径提取文件名
        if cn_image and "/" in cn_image:
            cn_image = cn_image.split("/")[-1]

        # 加载控制图
        ctrl_img_id = nid.next()
        workflow[ctrl_img_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": cn_image},
        }

        # 预处理器
        preprocessor = CONTROLNET_PREPROCESSOR_MAP.get(cn_type, "CannyEdgePreprocessor")
        preproc_id = nid.next()
        preproc_inputs: dict[str, Any] = {
            "image": [ctrl_img_id, 0],
            "resolution": 1024,
        }
        if cn_type == "canny":
            preproc_inputs["low_threshold"] = 100
            preproc_inputs["high_threshold"] = 200
        workflow[preproc_id] = {
            "class_type": preprocessor,
            "inputs": preproc_inputs,
        }

        # 加载 ControlNet Union 模型
        cn_loader_id = nid.next()
        workflow[cn_loader_id] = {
            "class_type": "ControlNetLoader",
            "inputs": {"control_net_name": FLUX_CONTROLNET},
        }
        cn_model_ref = [cn_loader_id, 0]

        # 设置 Union 控制类型
        union_type_idx = CONTROLNET_UNION_TYPE_MAP.get(cn_type, 0)
        cn_type_id = nid.next()
        workflow[cn_type_id] = {
            "class_type": "SetUnionControlNetType",
            "inputs": {
                "control_net": cn_model_ref,
                "type": union_type_idx,
            },
        }
        cn_model_ref = [cn_type_id, 0]

        # 应用 ControlNet
        cn_apply_id = nid.next()
        workflow[cn_apply_id] = {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": positive_cond,
                "negative": negative_cond,
                "control_net": cn_model_ref,
                "image": [preproc_id, 0],
                "strength": cn_strength,
                "start_percent": 0.0,
                "end_percent": 1.0,
            },
        }
        positive_cond = [cn_apply_id, 0]
        negative_cond = [cn_apply_id, 1]

    # ===================== 7. Latent 输入 =====================

    if input_image:
        # img2img: LoadImage → VAEEncode
        img_load_id = nid.next()
        workflow[img_load_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": input_image},
        }
        vae_encode_id = nid.next()
        workflow[vae_encode_id] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": [img_load_id, 0], "vae": vae_out},
        }
        latent_out = [vae_encode_id, 0]
        denoise_val = denoise
    else:
        # txt2img: EmptySD3LatentImage (Flux 使用 SD3 latent 格式)
        empty_latent_id = nid.next()
        workflow[empty_latent_id] = {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        }
        latent_out = [empty_latent_id, 0]
        denoise_val = 1.0

    # ===================== 8. KSampler =====================

    ksampler_id = nid.next()
    workflow[ksampler_id] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": seed,
            "steps": 4,
            "cfg": 1.0,
            "sampler_name": "euler",
            "scheduler": "simple",
            "denoise": denoise_val,
            "model": model_out,
            "positive": positive_cond,
            "negative": negative_cond,
            "latent_image": latent_out,
        },
    }

    # ===================== 9. VAE Decode =====================

    vae_decode_id = nid.next()
    workflow[vae_decode_id] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": [ksampler_id, 0], "vae": vae_out},
    }

    # ===================== 10. SaveImage =====================

    save_id = nid.next()
    workflow[save_id] = {
        "class_type": "SaveImage",
        "inputs": {"filename_prefix": "game_asset", "images": [vae_decode_id, 0]},
    }

    return workflow


# ---------------------------------------------------------------------------
#  BiRefNet 背景移除工作流
# ---------------------------------------------------------------------------

def build_remove_bg_workflow(*, image_name: str) -> dict:
    """构建 BiRefNet 背景移除工作流。

    LoadImage → RMBG (BiRefNet) → SaveImage (PNG with alpha)
    """
    return {
        "1": {
            "class_type": "LoadImage",
            "inputs": {"image": image_name},
        },
        "2": {
            "class_type": "RMBG",
            "inputs": {
                "image": ["1", 0],
                "model": "BiRefNet",
            },
        },
        "3": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "rmbg",
                "images": ["2", 0],
            },
        },
    }


# ---------------------------------------------------------------------------
#  ControlNet 预处理预览工作流
# ---------------------------------------------------------------------------

def build_controlnet_preview_workflow(
    *,
    image_name: str,
    control_type: str,
) -> dict:
    """构建 ControlNet 预处理预览的迷你工作流。"""
    preprocessor = CONTROLNET_PREPROCESSOR_MAP.get(control_type, "CannyEdgePreprocessor")

    preproc_inputs: dict[str, Any] = {
        "image": ["1", 0],
        "resolution": 1024,
    }
    if control_type == "canny":
        preproc_inputs["low_threshold"] = 100
        preproc_inputs["high_threshold"] = 200

    return {
        "1": {
            "class_type": "LoadImage",
            "inputs": {"image": image_name},
        },
        "2": {
            "class_type": preprocessor,
            "inputs": preproc_inputs,
        },
        "3": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "controlnet_preview",
                "images": ["2", 0],
            },
        },
    }


# ---------------------------------------------------------------------------
#  ComfyUI API 交互
# ---------------------------------------------------------------------------

async def queue_prompt(workflow: dict, client_id: str | None = None) -> str:
    """Submit a workflow to ComfyUI and return the prompt_id."""
    if client_id is None:
        client_id = str(uuid.uuid4())

    payload = {"prompt": workflow, "client_id": client_id}

    async with aiohttp.ClientSession() as session:
        async with session.post(f"{COMFYUI_URL}/prompt", json=payload) as resp:
            resp.raise_for_status()
            data = await resp.json()
            prompt_id = data["prompt_id"]
            logger.info("Queued prompt %s", prompt_id)
            return prompt_id


async def wait_for_completion(
    prompt_id: str,
    *,
    client_id: str | None = None,
    on_progress: Any = None,
    timeout: float = 300,
) -> dict:
    """Wait for a prompt to finish via WebSocket, returns history entry."""
    if client_id is None:
        client_id = str(uuid.uuid4())

    ws_url = f"{COMFYUI_URL.replace('http', 'ws')}/ws?clientId={client_id}"

    try:
        async with asyncio.timeout(timeout):
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(ws_url) as ws:
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            msg_type = data.get("type")

                            if msg_type == "progress":
                                d = data["data"]
                                if d.get("prompt_id") == prompt_id and on_progress:
                                    pct = d["value"] / d["max"] * 100
                                    await on_progress(pct)

                            elif msg_type == "executing":
                                d = data["data"]
                                if d.get("prompt_id") == prompt_id and d.get("node") is None:
                                    break

                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
    except TimeoutError:
        logger.warning("Timeout waiting for prompt %s", prompt_id)

    return await get_history(prompt_id)


async def get_history(prompt_id: str) -> dict:
    """Fetch the history entry for a prompt."""
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{COMFYUI_URL}/history/{prompt_id}") as resp:
            resp.raise_for_status()
            data = await resp.json()
            return data.get(prompt_id, {})


def extract_image_paths(history: dict) -> list[str]:
    """Extract output image file paths from a history entry."""
    paths: list[str] = []
    outputs = history.get("outputs", {})
    for _node_id, node_output in outputs.items():
        images = node_output.get("images", [])
        for img in images:
            filename = img.get("filename", "")
            subfolder = img.get("subfolder", "")
            if filename:
                full_path = os.path.join(COMFYUI_OUTPUT_DIR, subfolder, filename)
                paths.append(full_path)
    return paths


async def check_health() -> bool:
    """Check if ComfyUI is reachable."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{COMFYUI_URL}/system_stats",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                return resp.status == 200
    except Exception:
        return False
```

**Step 2: 删除旧工作流模板**

```bash
rm backend/app/workflows/txt2img_sdxl_lightning.json
rm backend/app/workflows/img2img_sdxl_lightning.json
```

注意：保留 `workflows/` 目录本身（未来可能放新模板）。

**Step 3: 验证**

Run: `cd /Users/gongxh/AI/bit-image-generation/backend && source .venv/bin/activate && python -c "from app.comfyui_client import build_flux_workflow, build_remove_bg_workflow; print(build_flux_workflow(prompt='test', seed=42)); print('OK')"`

**Step 4: Commit**

```bash
git add backend/app/comfyui_client.py
git rm backend/app/workflows/txt2img_sdxl_lightning.json backend/app/workflows/img2img_sdxl_lightning.json
git commit -m "refactor: 重写 ComfyUI 工作流构建器 — Flux.1 Schnell + BiRefNet"
```

---

### Task 4: 更新任务执行器

**Files:**
- Modify: `backend/app/task_runner.py`

**Step 1: 重写 task_runner.py**

关键变更：
1. `build_universal_workflow` → `build_flux_workflow`
2. 移除 `task_use_transparency` 参数
3. 新增 `_remove_bg_worker` 函数
4. 新增 `run_remove_bg_task` 入口
5. 训练 worker 改为调用 MFlux CLI

完整替换 `backend/app/task_runner.py`：

```python
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
        current_step = 0
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
```

**Step 2: 验证**

Run: `cd /Users/gongxh/AI/bit-image-generation/backend && source .venv/bin/activate && python -c "from app.task_runner import run_generation_task, run_remove_bg_task, run_training_job; print('OK')"`

**Step 3: Commit**

```bash
git add backend/app/task_runner.py
git commit -m "refactor: 重写任务执行器 — Flux.1 生成 + BiRefNet 抠图 + MFlux 训练"
```

---

### Task 5: 更新 main.py — API 路由

**Files:**
- Modify: `backend/app/main.py`

**Step 1: 更新 import**

替换 `backend/app/main.py` 顶部 import 区域：

```python
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
```

**Step 2: 更新 _migrate_columns — 移除旧迁移，添加新迁移**

替换 `_migrate_columns` 函数：

```python
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
```

注意：移除了 `use_transparency` 的迁移条目。SQLite 不支持删列，旧数据库中该列会保留但不再使用。

**Step 3: 更新 ControlNet 预览路由 — 更新支持的类型**

修改 `controlnet_preview` 函数中的 `valid_types`：

```python
valid_types = {"canny", "depth", "tile", "blur", "pose"}
```

**Step 4: 新增抠图 API 路由**

在生成中心和 ControlNet 预览路由之间添加：

```python
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
```

**Step 5: 更新 list_tasks — 包含抠图任务**

修改 `list_tasks` 函数：

```python
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
```

**Step 6: 更新 generate 路由 — 移除 use_transparency**

修改 `generate` 函数中的 task_data 构建（移除 use_transparency）：

```python
@app.post("/api/generate", response_model=GenerationTaskRead)
async def generate(
    payload: GenerationTaskCreate,
    session: AsyncSession = Depends(get_session),
) -> GenerationTask:
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
```

**Step 7: 验证**

Run: `cd /Users/gongxh/AI/bit-image-generation/backend && source .venv/bin/activate && python -c "from app.main import app; print('Routes:', [r.path for r in app.routes if hasattr(r, 'path')])"`

**Step 8: Commit**

```bash
git add backend/app/main.py
git commit -m "refactor: 更新 API 路由 — 新增抠图 API，移除 use_transparency"
```

---

## 阶段二：前端重构

### Task 6: 更新 TypeScript 类型定义

**Files:**
- Modify: `frontend/src/types/generation.ts`
- Modify: `frontend/src/types/common.ts`
- Modify: `frontend/src/types/training.ts`
- Create: `frontend/src/types/removeBg.ts`
- Modify: `frontend/src/types/index.ts`

**Step 1: 更新 generation.ts — 移除 use_transparency，更新 ControlNet 类型**

```typescript
/** 生成任务类型 */
export type GenerationType = 'txt2img' | 'img2img';

/** 生成任务状态 */
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';

/** ControlNet 配置（Flux.1 ControlNet Union） */
export interface ControlNetConfig {
  enabled: boolean;
  type: 'canny' | 'depth' | 'tile' | 'blur' | 'pose';
  image: string | null;
  strength: number;
}

/** 生成任务实体 */
export interface GenerationTask {
  id: number;
  style_id: number | null;
  type: GenerationType;
  prompt: string;
  negative_prompt: string;
  input_image: string | null;
  seed: number | null;
  batch_size: number;
  controlnet_config: ControlNetConfig | null;
  status: TaskStatus;
  output_paths: string[];
  created_at: string;
}

/** 创建生成任务请求 */
export interface GenerationTaskCreate {
  style_id?: number | null;
  type: GenerationType;
  prompt: string;
  negative_prompt?: string;
  input_image?: string | null;
  seed?: number | null;
  batch_size?: number;
  controlnet?: ControlNetConfig | null;
}

/** 生成结果（用于前端展示） */
export interface GenerationResult {
  id: string;
  taskId: number;
  imageUrl: string;
  filename: string;
  createdAt: string;
}
```

**Step 2: 更新 common.ts — 添加 remove_bg kind**

```typescript
/** WebSocket 进度消息 */
export interface WSProgressMessage {
  kind: 'generation' | 'training' | 'remove_bg';
  id: number;
  status: string;
  progress?: number;
  current_frame?: number;
  total_frames?: number;
  frame_progress?: number;
  output_paths?: string[];
  timestamp?: string;
}

/** 任务列表项 */
export interface TaskListItem {
  id: number;
  task_kind: 'training' | 'generation' | 'remove_bg';
  status: string;
  created_at: string;
  progress?: number;
  output_paths?: string[];
}
```

**Step 3: 更新 training.ts — MFlux 参数**

```typescript
/** 训练任务状态 */
export type TrainingStatus = 'queued' | 'running' | 'completed' | 'failed';

/** 训练任务实体 */
export interface TrainingJob {
  id: number;
  style_id: number | null;
  dataset_path: string;
  status: TrainingStatus;
  params: TrainingParams;
  progress: number;
  output_lora_path: string | null;
  created_at: string;
}

/** MFlux 训练参数 */
export interface TrainingParams {
  lora_rank: number;
  learning_rate: number;
  steps: number;
}

/** 创建训练任务请求 */
export interface TrainingJobCreate {
  style_name: string;
  style_type: 'ui' | 'vfx';
  dataset_path: string;
  params: TrainingParams;
}

/** 训练参数字段描述（用于表单提示） */
export const TRAINING_PARAM_HINTS: Record<keyof TrainingParams, { label: string; hint: string; min?: number; max?: number; step?: number; default: number }> = {
  lora_rank: {
    label: 'LoRA Rank',
    hint: 'LoRA 维度，值越大容量越大但越慢，建议 8-32',
    min: 4,
    max: 64,
    step: 4,
    default: 16,
  },
  learning_rate: {
    label: '学习率',
    hint: '控制模型更新速度，默认 0.0001',
    min: 0.00001,
    max: 0.01,
    step: 0.00001,
    default: 0.0001,
  },
  steps: {
    label: '训练步数',
    hint: '训练总步数，建议 500-3000',
    min: 100,
    max: 10000,
    step: 100,
    default: 1000,
  },
};
```

**Step 4: 创建 removeBg.ts**

```typescript
/** 抠图任务实体 */
export interface RemoveBgTask {
  id: number;
  input_image: string;
  output_image: string | null;
  model: 'birefnet' | 'birefnet-hr';
  status: 'queued' | 'running' | 'completed' | 'failed';
  source_task_id: number | null;
  created_at: string;
  completed_at: string | null;
}

/** 创建抠图任务请求 */
export interface RemoveBgTaskCreate {
  input_image: string;
  model?: 'birefnet' | 'birefnet-hr';
  source_task_id?: number | null;
}
```

**Step 5: 更新 index.ts — 导出新类型**

```typescript
export type { Style, StyleCreate, StyleType } from './style';
export type {
  ControlNetConfig,
  GenerationTask,
  GenerationTaskCreate,
  GenerationResult,
  GenerationType,
  TaskStatus,
} from './generation';
export type {
  TrainingJob,
  TrainingJobCreate,
  TrainingParams,
  TrainingStatus,
} from './training';
export { TRAINING_PARAM_HINTS } from './training';
export type { WSProgressMessage, TaskListItem } from './common';
export type { RemoveBgTask, RemoveBgTaskCreate } from './removeBg';
```

**Step 6: Commit**

```bash
git add frontend/src/types/
git commit -m "refactor: 更新前端类型定义 — 移除 use_transparency，新增抠图类型"
```

---

### Task 7: 更新前端 Services 和 Stores

**Files:**
- Create: `frontend/src/services/removeBg.ts`
- Modify: `frontend/src/services/generation.ts`
- Create: `frontend/src/stores/removeBgStore.ts`
- Modify: `frontend/src/stores/generationStore.ts`
- Modify: `frontend/src/stores/trainingStore.ts`
- Modify: `frontend/src/stores/taskStore.ts`
- Modify: `frontend/src/stores/index.ts`
- Modify: `frontend/src/hooks/useWebSocket.ts`

**Step 1: 创建 `frontend/src/services/removeBg.ts`**

```typescript
import type { RemoveBgTask, RemoveBgTaskCreate } from '@/types';
import api from './api';

/** 提交抠图任务 */
export async function submitRemoveBg(
  payload: RemoveBgTaskCreate,
): Promise<RemoveBgTask> {
  const { data } = await api.post<RemoveBgTask>('/api/remove-bg', payload);
  return data;
}

/** 获取抠图任务详情 */
export async function fetchRemoveBgTask(taskId: number): Promise<RemoveBgTask> {
  const { data } = await api.get<RemoveBgTask>(`/api/remove-bg/${taskId}`);
  return data;
}
```

**Step 2: 更新 `frontend/src/stores/generationStore.ts`**

关键变更：移除 `useTransparency` 参数。

修改 `submitGeneration` 参数类型 — 删除 `useTransparency` 字段：

```typescript
  submitGeneration: (params: {
    styleId: number;
    prompt: string;
    type: 'txt2img' | 'img2img';
    inputImage?: string | null;
    negativePrompt?: string;
    seed?: number | null;
    batchSize?: number;
    controlnet?: ControlNetConfig | null;
  }) => Promise<GenerationTask>;
```

修改 `submitGeneration` 实现 — 删除 `use_transparency` 字段：

```typescript
  submitGeneration: async ({
    styleId,
    prompt,
    type,
    inputImage,
    negativePrompt,
    seed,
    batchSize,
    controlnet,
  }) => {
    set({ loading: true, error: null, currentFrame: 0, totalFrames: batchSize ?? 1, frameProgress: 0 });
    try {
      const task = await submitGeneration({
        style_id: styleId,
        type,
        prompt,
        negative_prompt: negativePrompt,
        input_image: inputImage ?? undefined,
        seed: seed ?? undefined,
        batch_size: batchSize,
        controlnet: controlnet ?? undefined,
      });
      set({ currentTask: task, loading: false });
      return task;
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },
```

**Step 3: 创建 `frontend/src/stores/removeBgStore.ts`**

```typescript
import { create } from 'zustand';
import type { RemoveBgTask } from '@/types';
import { submitRemoveBg } from '@/services/removeBg';

interface RemoveBgStore {
  /** 当前抠图任务 */
  currentTask: RemoveBgTask | null;
  /** 抠图历史结果 */
  results: RemoveBgTask[];
  /** 加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  submitRemoveBg: (inputImage: string, sourceTaskId?: number | null) => Promise<RemoveBgTask>;
  updateTaskProgress: (data: { id: number; status: string; progress?: number; output_paths?: string[] }) => void;
  clearError: () => void;
}

export const useRemoveBgStore = create<RemoveBgStore>((set, get) => ({
  currentTask: null,
  results: [],
  loading: false,
  error: null,

  submitRemoveBg: async (inputImage, sourceTaskId) => {
    set({ loading: true, error: null });
    try {
      const task = await submitRemoveBg({
        input_image: inputImage,
        source_task_id: sourceTaskId,
      });
      set({ currentTask: task, loading: false });
      return task;
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  updateTaskProgress: (data) => {
    const { currentTask } = get();
    if (currentTask && currentTask.id === data.id) {
      const updated = {
        ...currentTask,
        status: data.status as RemoveBgTask['status'],
        output_image: data.output_paths?.[0] ?? currentTask.output_image,
      };
      set({ currentTask: updated });

      if (data.status === 'completed') {
        set((state) => ({ results: [updated, ...state.results] }));
      }
    }
  },

  clearError: () => set({ error: null }),
}));
```

**Step 4: 更新 `frontend/src/stores/trainingStore.ts`**

修改 `defaultParams` 为 MFlux 参数：

```typescript
const defaultParams: TrainingParams = {
  lora_rank: 16,
  learning_rate: 0.0001,
  steps: 1000,
};
```

修改 `submitTraining` 函数中的 `params` 字段：

```typescript
  submitTraining: async () => {
    set({ submitting: true, error: null });
    try {
      const { formData } = get();
      const job = await submitTraining({
        style_name: formData.styleName,
        style_type: formData.styleType,
        dataset_path: `datasets/${formData.styleName}`,
        params: formData.params,
      });
      set((s) => ({
        submitting: false,
        activeJobs: [job, ...s.activeJobs],
      }));
      return job;
    } catch (e) {
      set({ submitting: false, error: (e as Error).message });
      throw e;
    }
  },
```

**Step 5: 更新 `frontend/src/stores/taskStore.ts`**

修改 filter kind 类型：

```typescript
  filter: {
    kind: 'all' | 'training' | 'generation' | 'remove_bg';
    status: 'all' | 'queued' | 'running' | 'completed' | 'failed';
  };
```

**Step 6: 更新 `frontend/src/stores/index.ts`**

```typescript
export { useStyleStore } from './styleStore';
export { useGenerationStore } from './generationStore';
export { useTrainingStore } from './trainingStore';
export { useTaskStore } from './taskStore';
export { useRemoveBgStore } from './removeBgStore';
```

**Step 7: 更新 `frontend/src/hooks/useWebSocket.ts`**

在 `ws.onmessage` 的 switch 中添加 `remove_bg` case：

```typescript
import { useRemoveBgStore } from '@/stores/removeBgStore';

// ... 在 switch (data.kind) 中添加：
          case 'remove_bg':
            useRemoveBgStore.getState().updateTaskProgress({
              id: data.id,
              status: data.status,
              progress: data.progress,
              output_paths: data.output_paths,
            });
            break;
```

**Step 8: Commit**

```bash
git add frontend/src/services/ frontend/src/stores/ frontend/src/hooks/
git commit -m "refactor: 更新前端 services/stores/hooks — 新增抠图，移除 use_transparency"
```

---

### Task 8: 更新生成面板 UI

**Files:**
- Modify: `frontend/src/pages/Home/components/GenerationPanel.tsx`

**Step 1: 移除透明通道相关代码**

1. 删除 `Switch` 从 antd import
2. 删除表单中的透明通道开关（`Form.Item name="useTransparency"`）
3. 删除 `initialValues` 中的 `useTransparency: true`
4. 删除 `handleSubmit` 中的 `useTransparency: values.useTransparency ?? true`
5. 删除进度显示中的 `{currentTask.use_transparency && ' · 透明通道'}`

**Step 2: 更新 ControlNet 类型选项**

```typescript
const CONTROLNET_TYPE_OPTIONS = [
  { value: 'canny', label: 'Canny（边缘检测）' },
  { value: 'depth', label: 'Depth（深度图）' },
  { value: 'tile', label: 'Tile（细节增强）' },
  { value: 'blur', label: 'Blur（模糊引导）' },
  { value: 'pose', label: 'Pose（姿态控制）' },
];
```

**Step 3: 更新 ControlNet 状态类型**

```typescript
const [cnType, setCnType] = useState<'canny' | 'depth' | 'tile' | 'blur' | 'pose'>('canny');
```

以及 `handleCnTypeChange` 参数类型：

```typescript
const handleCnTypeChange = (value: 'canny' | 'depth' | 'tile' | 'blur' | 'pose') => {
```

**Step 4: 更新 handleSubmit**

```typescript
  const handleSubmit = async () => {
    if (!selectedStyleId) {
      message.warning('请先在左侧选择一个风格');
      return;
    }
    try {
      const values = await form.validateFields();
      const genType = values.type as 'txt2img' | 'img2img';

      if (genType === 'img2img' && !uploadedImageUrl) {
        message.warning('图生图模式需要上传参考图片');
        return;
      }

      let controlnet: ControlNetConfig | null = null;
      if (cnEnabled && cnImageUrl) {
        controlnet = {
          enabled: true,
          type: cnType,
          image: cnImageUrl,
          strength: cnStrength,
        };
      }

      setGenerating(selectedStyleId, true);
      await submit({
        styleId: selectedStyleId,
        prompt: values.prompt,
        type: genType,
        inputImage: genType === 'img2img' ? uploadedImageUrl : undefined,
        negativePrompt: values.negativePrompt,
        seed: values.seed || null,
        batchSize: values.batchSize ?? 1,
        controlnet,
      });
      message.success('生成任务已提交');
    } catch {
      // 校验失败或提交失败
    }
  };
```

**Step 5: 更新 ControlNet 说明文案**

更新 Popover 中的说明，将四种类型改为五种，并移除"带透明背景的游戏角色"等描述。

**Step 6: Commit**

```bash
git add frontend/src/pages/Home/components/GenerationPanel.tsx
git commit -m "refactor: 更新生成面板 — 移除透明通道，更新 ControlNet 为 Union"
```

---

### Task 9: 更新结果画廊 — 添加抠图按钮

**Files:**
- Modify: `frontend/src/pages/Home/components/ResultGallery.tsx`

**Step 1: 移除 isTransparent 逻辑，添加抠图按钮**

1. 删除 `isTransparent` 相关代码
2. 为每张图片添加「抠图」快捷按钮
3. import `useRemoveBgStore` 和 `ScissorOutlined` 图标

关键修改：在每张图片的 `downloadOverlay` 区域旁添加抠图按钮：

```typescript
import { useRemoveBgStore } from '@/stores';
import { ScissorOutlined } from '@ant-design/icons';

// 在组件内：
const submitRemoveBg = useRemoveBgStore((s) => s.submitRemoveBg);

const handleRemoveBg = async (imageUrl: string, taskId: number) => {
  try {
    await submitRemoveBg(imageUrl, taskId);
    message.success('抠图任务已提交');
  } catch {
    message.error('抠图任务提交失败');
  }
};
```

在图片卡片中添加抠图按钮（与下载按钮并排）：

```tsx
<div className={styles.downloadOverlay}>
  <Space size={4}>
    <Button
      type="text"
      size="small"
      icon={<ScissorOutlined />}
      onClick={(e) => {
        e.stopPropagation();
        handleRemoveBg(result.imageUrl, result.taskId);
      }}
      className={styles.downloadBtn}
      title="抠图去背景"
    />
    <Button
      type="text"
      size="small"
      icon={<DownloadOutlined />}
      onClick={(e) => {
        e.stopPropagation();
        downloadImage(result.imageUrl, result.filename);
      }}
      className={styles.downloadBtn}
    />
  </Space>
</div>
```

**Step 2: 移除 checkerboard 背景逻辑**

删除 `isTransparent` 变量和 `${isTransparent ? styles.checkerboard : ''}` className 条件。

**Step 3: Commit**

```bash
git add frontend/src/pages/Home/components/ResultGallery.tsx
git commit -m "refactor: 更新结果画廊 — 移除透明背景，添加抠图按钮"
```

---

### Task 10: 创建抠图页面

**Files:**
- Create: `frontend/src/pages/RemoveBg/index.tsx`
- Create: `frontend/src/pages/RemoveBg/RemoveBg.module.css`

**Step 1: 创建 `frontend/src/pages/RemoveBg/index.tsx`**

实现功能：
- 拖拽上传或从 URL 输入
- 左右对比预览（原图 vs 抠图结果，棋盘格背景）
- 进度显示
- 一键下载透明 PNG

```typescript
// 页面核心结构：
// - 顶部标题 + 返回按钮
// - 上传区域（Dragger 或 URL 输入）
// - 对比预览区（左原图 右结果，棋盘格背景）
// - 操作按钮（开始抠图、下载 PNG）
// - 历史结果列表
```

（完整代码在实施时编写，此处标注页面结构和交互设计）

**Step 2: 创建 CSS Module**

棋盘格背景样式：
```css
.checkerboard {
  background-image:
    linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
    linear-gradient(-45deg, transparent 75%, #2a2a2a 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}
```

**Step 3: Commit**

```bash
git add frontend/src/pages/RemoveBg/
git commit -m "feat: 新增抠图页面 — 上传、预览、下载透明 PNG"
```

---

### Task 11: 更新路由和导航

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout/Header.tsx`

**Step 1: 更新 App.tsx — 添加抠图路由**

```typescript
const RemoveBg = lazy(() => import('@/pages/RemoveBg'));

// Routes 中添加：
<Route path="/remove-bg" element={<RemoveBg />} />
```

**Step 2: 更新 Header.tsx — 添加导航项**

```typescript
import { ScissorOutlined } from '@ant-design/icons';

// menuItems 中添加：
{
  key: '/remove-bg',
  icon: <ScissorOutlined />,
  label: '抠图工具',
},
```

**Step 3: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Layout/Header.tsx
git commit -m "feat: 添加抠图页面路由和导航"
```

---

### Task 12: 更新历史页面

**Files:**
- Modify: `frontend/src/pages/History/index.tsx`

**Step 1: 添加 remove_bg 类型标签**

```typescript
import { ScissorOutlined } from '@ant-design/icons';

const kindLabels: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  training: { label: '训练', color: 'purple', icon: <ExperimentOutlined /> },
  generation: { label: '生成', color: 'blue', icon: <PictureOutlined /> },
  remove_bg: { label: '抠图', color: 'green', icon: <ScissorOutlined /> },
};
```

**Step 2: 更新筛选下拉**

```typescript
options={[
  { value: 'all', label: '全部类型' },
  { value: 'generation', label: '生成任务' },
  { value: 'remove_bg', label: '抠图任务' },
  { value: 'training', label: '训练任务' },
]}
```

**Step 3: Commit**

```bash
git add frontend/src/pages/History/index.tsx
git commit -m "refactor: 更新历史页面 — 添加抠图任务类型"
```

---

### Task 13: 更新训练页面

**Files:**
- Modify: `frontend/src/pages/Training/components/ParamsForm.tsx`（如果存在）

**Step 1: 更新训练参数表单**

将 SDXL 训练参数（batch_size, learning_rate, max_train_steps, resolution, save_every_n_steps）替换为 MFlux 参数（lora_rank, learning_rate, steps）。

参照 `frontend/src/types/training.ts` 中更新后的 `TRAINING_PARAM_HINTS`。

**Step 2: 更新训练页面标题**

将"训练中心"更新提示文案，注明使用 MFlux 训练 Flux LoRA。

**Step 3: Commit**

```bash
git add frontend/src/pages/Training/
git commit -m "refactor: 更新训练页面 — 适配 MFlux 参数"
```

---

## 阶段三：基础设施更新

### Task 14: 更新启动脚本

**Files:**
- Modify: `scripts/macos/start.sh`
- Modify: `scripts/windows/start.ps1`

**Step 1: 更新模型检查**

替换 SDXL 模型检查为 Flux.1 Schnell 模型检查：

```bash
# macOS start.sh
UNET_DIR="$COMFYUI_DIR/models/unet"
CLIP_DIR="$COMFYUI_DIR/models/clip"
VAE_DIR="$COMFYUI_DIR/models/vae"

if [ ! -f "$UNET_DIR/flux1-schnell-Q5_K_S.gguf" ]; then
  echo "⚠️  未找到 Flux.1 Schnell GGUF 模型，请下载到: $UNET_DIR/flux1-schnell-Q5_K_S.gguf"
fi
if [ ! -f "$CLIP_DIR/clip_l.safetensors" ]; then
  echo "⚠️  未找到 CLIP-L 编码器，请下载到: $CLIP_DIR/clip_l.safetensors"
fi
if [ ! -f "$CLIP_DIR/t5xxl_fp16.safetensors" ]; then
  echo "⚠️  未找到 T5-XXL 编码器，请下载到: $CLIP_DIR/t5xxl_fp16.safetensors"
fi
if [ ! -f "$VAE_DIR/ae.safetensors" ]; then
  echo "⚠️  未找到 Flux VAE，请下载到: $VAE_DIR/ae.safetensors"
fi
```

**Step 2: 同步 Windows 脚本**

对 `scripts/windows/start.ps1` 做同样的模型路径更新。

**Step 3: Commit**

```bash
git add scripts/
git commit -m "refactor: 更新启动脚本 — Flux.1 Schnell 模型检查"
```

---

### Task 15: 更新文档

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `backend/README.md`

**Step 1: 更新 CLAUDE.md**

关键变更：
- 项目概述：SDXL → Flux.1 Schnell
- 必需模型文件列表更新
- API 路由新增 `/api/remove-bg`
- WebSocket 消息格式添加 `remove_bg` kind
- 移除 LayerDiffusion 相关描述

**Step 2: 更新 README.md**

- 技术栈更新
- 模型下载指引更新

**Step 3: Commit**

```bash
git add CLAUDE.md README.md backend/README.md
git commit -m "docs: 更新项目文档 — Flux.1 Schnell 迁移"
```

---

### Task 16: 删除旧数据库并验证全流程

**Step 1: 备份旧数据库**

```bash
cp game_asset_generator.db game_asset_generator.db.bak
```

**Step 2: 删除旧数据库（让系统重建）**

```bash
rm game_asset_generator.db
```

**Step 3: 启动后端验证**

```bash
cd /Users/gongxh/AI/bit-image-generation/backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

检查：
- 数据库自动创建，表结构正确
- `/docs` Swagger UI 可访问
- 所有 API 端点正常加载
- 基础风格自动创建

**Step 4: 前端构建验证**

```bash
cd /Users/gongxh/AI/bit-image-generation/frontend
npm run build
```

检查：TypeScript 编译无错误。

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: 全流程验证通过 — Flux.1 Schnell 迁移完成"
```

---

## 实施顺序总结

| 序号 | Task | 描述 | 依赖 |
|------|------|------|------|
| 1 | Task 1 | 更新数据库模型 | 无 |
| 2 | Task 2 | 更新 Pydantic Schema | Task 1 |
| 3 | Task 3 | 重写 ComfyUI 工作流构建器 | 无 |
| 4 | Task 4 | 更新任务执行器 | Task 1, 3 |
| 5 | Task 5 | 更新 main.py API 路由 | Task 1, 2, 3, 4 |
| 6 | Task 6 | 更新前端 TypeScript 类型 | 无 |
| 7 | Task 7 | 更新前端 Services/Stores/Hooks | Task 6 |
| 8 | Task 8 | 更新生成面板 UI | Task 7 |
| 9 | Task 9 | 更新结果画廊 | Task 7 |
| 10 | Task 10 | 创建抠图页面 | Task 7 |
| 11 | Task 11 | 更新路由和导航 | Task 10 |
| 12 | Task 12 | 更新历史页面 | Task 6 |
| 13 | Task 13 | 更新训练页面 | Task 6, 7 |
| 14 | Task 14 | 更新启动脚本 | 无 |
| 15 | Task 15 | 更新文档 | 全部 |
| 16 | Task 16 | 全流程验证 | 全部 |

## ComfyUI 环境准备（手动步骤）

在执行代码重构前，需要确保 ComfyUI 环境就绪：

1. **安装 ComfyUI-GGUF 插件**：
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/city96/ComfyUI-GGUF.git
   ```

2. **安装 ComfyUI-RMBG 插件**：
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/1038lab/ComfyUI-RMBG.git
   ```

3. **下载 Flux.1 Schnell GGUF 模型**：
   - `ComfyUI/models/unet/flux1-schnell-Q5_K_S.gguf`
   - 来源：https://huggingface.co/city96/FLUX.1-schnell-gguf

4. **下载 Flux CLIP 编码器**：
   - `ComfyUI/models/clip/clip_l.safetensors`
   - `ComfyUI/models/clip/t5xxl_fp16.safetensors`

5. **下载 Flux VAE**：
   - `ComfyUI/models/vae/ae.safetensors`

6. **下载 ControlNet Union（可选）**：
   - `ComfyUI/models/controlnet/instantx-flux-union-controlnet.safetensors`

7. **安装 MFlux（训练用）**：
   ```bash
   pip install mflux
   ```
