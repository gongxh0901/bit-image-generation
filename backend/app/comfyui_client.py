"""ComfyUI REST/WebSocket client.

Talks to the ComfyUI server (default http://127.0.0.1:8188) to:
- Queue a workflow (prompt)
- Track progress via WebSocket
- Retrieve finished images
"""

from __future__ import annotations

import asyncio
import copy
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
            # For numeric values, replace the quoted placeholder with bare number
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
    """Build a txt2img API prompt from the workflow template."""
    wf = _load_workflow("txt2img_sdxl_lightning.json")

    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    replacements: dict[str, Any] = {
        "positive_prompt": positive_prompt,
        "negative_prompt": negative_prompt,
        "seed": seed,
    }
    wf = _fill_template(wf, replacements)

    # Override width/height
    wf["5"]["inputs"]["width"] = width
    wf["5"]["inputs"]["height"] = height

    # Override checkpoint / LoRA if specified
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
    """Build an img2img API prompt from the workflow template."""
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
