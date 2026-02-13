"""ComfyUI REST/WebSocket client.

Talks to the ComfyUI server (default http://127.0.0.1:8188) to:
- Queue a workflow (prompt)
- Track progress via WebSocket
- Retrieve finished images

动态构建工作流，支持：
- 透明通道 (LayerDiffusion)
- ControlNet Union ProMax
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

WORKFLOW_DIR = Path(__file__).resolve().parent / "workflows"


# ---------------------------------------------------------------------------
#  ControlNet Union 类型映射
# ---------------------------------------------------------------------------

# ComfyUI SetUnionControlNetType 节点使用的类型字符串
CONTROLNET_UNION_TYPE_MAP: dict[str, str] = {
    "canny":    "canny/lineart/anime_lineart/mlsd",
    "lineart":  "canny/lineart/anime_lineart/mlsd",
    "depth":    "depth",
    "scribble": "hed/pidi/scribble/ted",
}

# 对应 comfyui_controlnet_aux 预处理器节点名
CONTROLNET_PREPROCESSOR_MAP: dict[str, str] = {
    "canny":    "CannyEdgePreprocessor",
    "lineart":  "LineArtPreprocessor",
    "depth":    "DepthAnythingV2Preprocessor",
    "scribble": "ScribblePreprocessor",
}


# ---------------------------------------------------------------------------
#  旧版模板工作流（保留向后兼容）
# ---------------------------------------------------------------------------

def _load_workflow(name: str) -> dict:
    fp = WORKFLOW_DIR / name
    with open(fp) as f:
        return json.load(f)


def _fill_template(workflow: dict, replacements: dict[str, Any]) -> dict:
    """Replace {{placeholder}} strings in the workflow JSON."""
    raw = json.dumps(workflow)
    for key, value in replacements.items():
        placeholder = "{{" + key + "}}"
        if isinstance(value, (int, float)):
            raw = raw.replace(f'"{placeholder}"', str(value))
        raw = raw.replace(placeholder, str(value))
    return json.loads(raw)


def build_txt2img_prompt(
    *,
    positive_prompt: str,
    negative_prompt: str = "ugly, blurry, low quality, watermark, text",
    seed: int | None = None,
    width: int = 1024,
    height: int = 1024,
    lora_name: str | None = None,
    checkpoint: str | None = None,
) -> dict:
    """Build a txt2img API prompt from the workflow template (legacy)."""
    wf = _load_workflow("txt2img_sdxl_lightning.json")
    if seed is None:
        seed = random.randint(0, 2**32 - 1)
    replacements: dict[str, Any] = {
        "positive_prompt": positive_prompt,
        "negative_prompt": negative_prompt,
        "seed": seed,
    }
    wf = _fill_template(wf, replacements)
    wf["5"]["inputs"]["width"] = width
    wf["5"]["inputs"]["height"] = height
    if checkpoint:
        wf["4"]["inputs"]["ckpt_name"] = checkpoint
    if lora_name:
        wf["10"]["inputs"]["lora_name"] = lora_name
    return wf


def build_img2img_prompt(
    *,
    positive_prompt: str,
    negative_prompt: str = "ugly, blurry, low quality, watermark, text",
    input_image: str,
    seed: int | None = None,
    denoise: float = 0.6,
    lora_name: str | None = None,
    checkpoint: str | None = None,
) -> dict:
    """Build an img2img API prompt from the workflow template (legacy)."""
    wf = _load_workflow("img2img_sdxl_lightning.json")
    if seed is None:
        seed = random.randint(0, 2**32 - 1)
    replacements: dict[str, Any] = {
        "positive_prompt": positive_prompt,
        "negative_prompt": negative_prompt,
        "seed": seed,
        "input_image": input_image,
    }
    wf = _fill_template(wf, replacements)
    wf["3"]["inputs"]["denoise"] = denoise
    if checkpoint:
        wf["4"]["inputs"]["ckpt_name"] = checkpoint
    if lora_name:
        wf["10"]["inputs"]["lora_name"] = lora_name
    return wf


# ---------------------------------------------------------------------------
#  动态工作流构建（新版，支持透明通道 + ControlNet）
# ---------------------------------------------------------------------------


class _NodeIdCounter:
    """节点 ID 计数器"""
    def __init__(self) -> None:
        self._id = 0

    def next(self) -> str:
        self._id += 1
        return str(self._id)


def build_universal_workflow(
    *,
    prompt: str,
    negative_prompt: str = "ugly, blurry, low quality, watermark, text",
    seed: int,
    use_transparency: bool = True,
    controlnet: dict | None = None,
    input_image: str | None = None,
    lora_name: str | None = None,
    checkpoint: str | None = None,
    width: int = 1024,
    height: int = 1024,
    denoise: float = 0.6,
) -> dict:
    """动态构建 ComfyUI workflow dict。

    根据参数条件注入节点：
    - use_transparency=True → 注入 LayerDiffusion 节点
    - controlnet.enabled=True → 注入 ControlNet Union 节点
    - input_image → img2img 模式（LoadImage + VAEEncode）
    """
    workflow: dict[str, dict] = {}
    nid = _NodeIdCounter()

    # ===================== 1. 基础模型加载 =====================

    # CheckpointLoader
    ckpt_id = nid.next()
    workflow[ckpt_id] = {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": checkpoint or "sd_xl_base_1.0.safetensors"},
    }
    model_out = [ckpt_id, 0]
    clip_out = [ckpt_id, 1]
    vae_out = [ckpt_id, 2]

    # LoRA (SDXL Lightning 4-step)
    lora_id = nid.next()
    workflow[lora_id] = {
        "class_type": "LoraLoader",
        "inputs": {
            "lora_name": lora_name or "sdxl_lightning_4step_lora.safetensors",
            "strength_model": 1,
            "strength_clip": 1,
            "model": model_out,
            "clip": clip_out,
        },
    }
    model_out = [lora_id, 0]
    clip_out = [lora_id, 1]

    # ===================== 2. LayerDiffusion Apply（模型注入） =====================

    if use_transparency:
        ld_apply_id = nid.next()
        workflow[ld_apply_id] = {
            "class_type": "LayeredDiffusionApply",
            "inputs": {
                "model": model_out,
                "config": "SDXL, Attention Injection",
                "weight": 1.0,
            },
        }
        model_out = [ld_apply_id, 0]

    # ===================== 3. 文本编码 =====================

    pos_clip_id = nid.next()
    workflow[pos_clip_id] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": prompt, "clip": clip_out},
    }
    positive_cond = [pos_clip_id, 0]

    neg_clip_id = nid.next()
    workflow[neg_clip_id] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": negative_prompt, "clip": clip_out},
    }
    negative_cond = [neg_clip_id, 0]

    # ===================== 4. ControlNet（可选） =====================

    if controlnet and controlnet.get("enabled"):
        cn_type = controlnet.get("type", "canny")
        cn_image = controlnet.get("image", "")
        cn_strength = controlnet.get("strength", 1.0)

        # 从 URL 路径提取文件名
        if cn_image and "/" in cn_image:
            cn_image = cn_image.split("/")[-1]

        # 4a. 加载控制图
        ctrl_img_id = nid.next()
        workflow[ctrl_img_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": cn_image},
        }

        # 4b. 预处理器
        preprocessor = CONTROLNET_PREPROCESSOR_MAP.get(cn_type, "CannyEdgePreprocessor")
        preproc_id = nid.next()
        preproc_inputs: dict[str, Any] = {
            "image": [ctrl_img_id, 0],
            "resolution": 1024,
        }
        # Canny 有额外参数
        if cn_type == "canny":
            preproc_inputs["low_threshold"] = 100
            preproc_inputs["high_threshold"] = 200
        workflow[preproc_id] = {
            "class_type": preprocessor,
            "inputs": preproc_inputs,
        }

        # 4c. 加载 ControlNet Union ProMax 模型
        cn_loader_id = nid.next()
        workflow[cn_loader_id] = {
            "class_type": "ControlNetLoader",
            "inputs": {"control_net_name": "diffusion_pytorch_model_promax.safetensors"},
        }
        cn_model_ref = [cn_loader_id, 0]

        # 4d. 设置 Union 控制类型
        union_type = CONTROLNET_UNION_TYPE_MAP.get(cn_type, "canny/lineart/anime_lineart/mlsd")
        cn_type_id = nid.next()
        workflow[cn_type_id] = {
            "class_type": "SetUnionControlNetType",
            "inputs": {
                "control_net": cn_model_ref,
                "type": union_type,
            },
        }
        cn_model_ref = [cn_type_id, 0]

        # 4e. 应用 ControlNet
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

    # ===================== 5. Latent 输入 =====================

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
        # txt2img: EmptyLatentImage
        empty_latent_id = nid.next()
        workflow[empty_latent_id] = {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        }
        latent_out = [empty_latent_id, 0]
        denoise_val = 1.0

    # ===================== 6. KSampler =====================

    ksampler_id = nid.next()
    workflow[ksampler_id] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": seed,
            "steps": 4,
            "cfg": 1.5,
            "sampler_name": "euler",
            "scheduler": "sgm_uniform",
            "denoise": denoise_val,
            "model": model_out,
            "positive": positive_cond,
            "negative": negative_cond,
            "latent_image": latent_out,
        },
    }

    # ===================== 7. VAE Decode =====================

    vae_decode_id = nid.next()
    workflow[vae_decode_id] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": [ksampler_id, 0], "vae": vae_out},
    }
    image_out = [vae_decode_id, 0]

    # ===================== 8. LayerDiffusion Decode（RGBA） =====================

    if use_transparency:
        ld_decode_id = nid.next()
        workflow[ld_decode_id] = {
            "class_type": "LayeredDiffusionDecodeRGBA",
            "inputs": {
                "samples": [ksampler_id, 0],
                "images": [vae_decode_id, 0],
                "sd_version": "SDXL",
            },
        }
        image_out = [ld_decode_id, 0]

    # ===================== 9. SaveImage =====================

    save_id = nid.next()
    workflow[save_id] = {
        "class_type": "SaveImage",
        "inputs": {"filename_prefix": "game_asset", "images": image_out},
    }

    return workflow


def build_controlnet_preview_workflow(
    *,
    image_name: str,
    control_type: str,
) -> dict:
    """构建 ControlNet 预处理预览的迷你工作流。

    只包含 LoadImage → Preprocessor → SaveImage，用于预览预处理效果。
    """
    preprocessor = CONTROLNET_PREPROCESSOR_MAP.get(control_type, "CannyEdgePreprocessor")

    preproc_inputs: dict[str, Any] = {
        "image": ["1", 0],
        "resolution": 1024,
    }
    if control_type == "canny":
        preproc_inputs["low_threshold"] = 100
        preproc_inputs["high_threshold"] = 200

    workflow: dict[str, dict] = {
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
    return workflow


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
                                    # Execution finished
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
            async with session.get(f"{COMFYUI_URL}/system_stats", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                return resp.status == 200
    except Exception:
        return False
