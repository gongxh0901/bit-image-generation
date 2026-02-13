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
