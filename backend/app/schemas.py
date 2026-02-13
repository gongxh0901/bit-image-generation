from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------- ControlNet ----------


class ControlNetConfig(BaseModel):
    """ControlNet 配置"""
    enabled: bool = False
    type: Literal["canny", "depth", "scribble", "lineart"] = "canny"
    image: str | None = None       # 上传控制图的 URL
    strength: float = Field(default=1.0, ge=0.0, le=2.0)


# ---------- 风格 ----------


class StyleCreate(BaseModel):
    name: str
    type: Literal["ui", "vfx"]
    lora_path: str | None = None
    trigger_words: str | None = None
    preview_image: str | None = None
    is_base: bool = False
    is_trained: bool = False


class StyleUpdate(BaseModel):
    name: str | None = None
    type: Literal["ui", "vfx"] | None = None
    trigger_words: str | None = None
    preview_image: str | None = None


class StyleRead(BaseModel):
    id: int
    name: str
    type: str
    lora_path: str | None
    trigger_words: str | None
    preview_image: str | None
    is_base: bool
    is_trained: bool
    created_at: datetime

    class Config:
        from_attributes = True


class TrainingJobCreate(BaseModel):
    style_name: str  # 训练时同步创建风格的名称
    style_type: Literal["ui", "vfx"] = "ui"
    dataset_path: str
    params: dict[str, Any] = Field(default_factory=dict)


class TrainingJobRead(BaseModel):
    id: int
    style_id: int | None
    dataset_path: str
    status: str
    params: dict[str, Any]
    progress: float
    output_lora_path: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class GenerationTaskCreate(BaseModel):
    style_id: int | None = None
    type: Literal["txt2img", "img2img"]
    prompt: str
    negative_prompt: str = "ugly, blurry, low quality, watermark, text"
    input_image: str | None = None
    seed: int | None = None        # 不填则随机

    use_transparency: bool = True
    batch_size: int = Field(default=1, ge=1, le=32)
    controlnet: ControlNetConfig | None = None


class GenerationTaskRead(BaseModel):
    id: int
    style_id: int | None
    type: str
    prompt: str
    negative_prompt: str
    input_image: str | None
    seed: int | None
    use_transparency: bool
    batch_size: int
    controlnet_config: dict | None
    status: str
    output_paths: list[str]
    created_at: datetime

    class Config:
        from_attributes = True


class TaskListItem(BaseModel):
    id: int
    task_kind: Literal["training", "generation"]
    status: str
    created_at: datetime
    progress: float | None = None
    output_paths: list[str] | None = None
