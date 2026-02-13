# 项目重构设计：迁移至 Flux.1 Schnell + BiRefNet

> 日期：2026-02-13
> 状态：已确认

## 1. 背景与目标

当前项目基于 SDXL + Lightning LoRA + LayerDiffusion 构建，存在以下痛点：
- SDXL 图像质量已被新一代模型超越
- LayerDiffusion 透明通道效果不稳定，与 Lightning LoRA 不兼容时需要 25 步慢速采样
- 透明通道需求可用后处理抠图替代，效果更可控

**重构目标：**
- 升级到 Flux.1 Schnell（当前最强商用开源模型）
- 移除 LayerDiffusion，改用 BiRefNet 抠图去背景
- 全面重构前后端

## 2. 技术选型

| 组件 | 当前 | 重构后 |
|------|------|--------|
| 生成模型 | SDXL + Lightning LoRA | **Flux.1 Schnell** (GGUF Q5/Q6, Apache 2.0) |
| 透明通道 | LayerDiffusion | **移除** |
| 背景移除 | 无 | **BiRefNet** (ComfyUI 节点集成) |
| ControlNet | SDXL ControlNet (Canny/Depth/Scribble/Lineart) | **Flux.1 ControlNet Union** (Canny/Depth/Tile/Blur/Pose 合一) |
| LoRA 训练 | SDXL ComfyUI 内置训练 | **MFlux** (MLX 原生, Apple Silicon 优化) |
| 推理框架 | ComfyUI | **ComfyUI + ComfyUI-GGUF** |
| 前端 | React + TS + Ant Design | **保留技术栈，重新设计 UI** |
| 后端 | FastAPI + SQLite | **保留技术栈，重构 API 和工作流** |

### 选型理由

**Flux.1 Schnell：**
- Apache 2.0 开源，商用自由
- GGUF Q5/Q6 仅需 ~8-9GB 显存，M4 24G 余量充足
- 4 步快速出图约 30 秒（1024x1024）
- ControlNet Union 已可用（InstantX 提供）
- LoRA 生态持续增长

**BiRefNet：**
- 开源精度最高（IoU 0.87, Dice 0.92）
- 边缘细节极佳
- 有 ComfyUI 节点集成

**MFlux：**
- MLX 原生实现，Apple Silicon 深度优化
- 支持 Flux LoRA 训练
- 比 PyTorch MPS 性能更好

## 3. 核心架构

```
前端 (React/TS, :3000)
  ├── 生成面板（txt2img / img2img）
  ├── 抠图面板（上传图片 → BiRefNet → 透明 PNG）     ← 新增
  ├── LoRA 训练（MFlux 后端）
  └── 历史任务
        ↕
后端 (FastAPI, :8000)
  ├── ComfyUI 客户端（Flux.1 Schnell 工作流）        ← 重写
  ├── BiRefNet 抠图服务                               ← 新增
  ├── MFlux 训练管理                                  ← 重写
  └── SQLite + WebSocket 进度推送
        ↕
ComfyUI (:8188)
  ├── Flux.1 Schnell GGUF 模型
  ├── ControlNet Union 模型
  └── BiRefNet 节点（ComfyUI-RMBG）
```

**关键设计决策：** 生成和抠图解耦为独立步骤。用户可先生成实体图，再按需抠图去背景，也可对外部上传的图片直接抠图。

## 4. 数据库模型

### 修改的模型

```python
# Style — 调整 LoRA 关联
class Style:
    id, name, type              # 保留
    lora_path                   # 保留，指向 Flux LoRA
    trigger_words               # 保留
    preview_image               # 保留
    is_base, is_trained         # 保留

# GenerationTask — 精简
class GenerationTask:
    id, style_id, prompt, negative_prompt  # 保留
    type: str                  # "txt2img" | "img2img"
    input_image: str           # img2img 参考图
    seed: int
    batch_size: int
    controlnet_config: JSON    # ControlNet Union 格式
    status, output_paths       # 保留
    # use_transparency 移除

# TrainingJob — 重写
class TrainingJob:
    id, style_id, dataset_path
    status, progress
    output_lora_path
    params: JSON               # MFlux 训练参数（lr, steps, rank 等）
    training_backend: str      # "mflux"
```

### 新增模型

```python
# BackgroundRemovalTask — 新增
class BackgroundRemovalTask:
    id: int
    input_image: str           # 原始图片路径
    output_image: str          # 抠图结果路径（透明 PNG）
    model: str                 # "birefnet" | "birefnet-hr"
    status: str                # "pending" | "completed" | "failed"
    source_task_id: int | None # 关联的生成任务（可选）
    created_at, completed_at
```

## 5. API 设计

```
# 生成相关
POST   /api/generate              → 提交生成任务
GET    /api/tasks                  → 任务列表（生成 + 训练 + 抠图）
GET    /api/tasks/{id}             → 任务详情
DELETE /api/tasks/{id}             → 删除任务

# 抠图相关（新增）
POST   /api/remove-bg              → 提交抠图任务
GET    /api/remove-bg/{id}         → 抠图结果

# 风格/LoRA
GET    /api/styles                 → 风格列表
POST   /api/styles                 → 创建风格
PUT    /api/styles/{id}            → 更新风格
DELETE /api/styles/{id}            → 删除风格

# 训练
POST   /api/training               → 启动 MFlux LoRA 训练
GET    /api/training/{id}          → 训练状态

# ControlNet
POST   /api/controlnet/preview     → ControlNet 预处理预览

# 上传
POST   /api/upload                 → 上传图片

# WebSocket
WS     /ws/progress                → 实时进度（生成 + 训练 + 抠图）
```

### WebSocket 消息格式

```json
{
  "kind": "generation | training | remove_bg",
  "id": "任务ID",
  "status": "running | completed | failed | partial",
  "progress": 0.0,
  "output_paths": []
}
```

## 6. 前端 UI 设计

### 页面结构

```
├── 生成 (Home)         — 核心功能：txt2img / img2img + 结果画廊
├── 抠图 (RemoveBg)     — 新增：批量抠图 + 预览对比
├── 训练 (Training)     — LoRA 训练（MFlux 后端）
└── 历史 (History)      — 所有任务历史（生成 + 抠图 + 训练）
```

### 生成页面变化
- **移除**：透明通道开关
- **修改**：ControlNet 改为 Union 模式（Canny/Depth/Tile/Blur/Pose）
- **新增**：结果画廊中每张图增加「抠图」快捷按钮

### 抠图页面（新增）
- 拖拽上传或从生成历史选择
- 左右对比预览（棋盘格背景显示透明区域）
- 支持批量抠图
- 一键下载透明 PNG

### 训练页面
- 训练参数适配 MFlux（学习率、训练步数、LoRA rank 等）
- 数据集管理保留
- 训练进度展示

### 历史页面
- 新增抠图任务类型
- 筛选 tab：全部 / 生成 / 抠图 / 训练

## 7. ComfyUI 工作流

### 必需模型文件

```
ComfyUI/models/
├── unet/
│   └── flux1-schnell-Q5_K_S.gguf          # Flux.1 Schnell GGUF
├── clip/
│   ├── clip_l.safetensors                   # CLIP-L 文本编码器
│   └── t5xxl_fp16.safetensors               # T5-XXL 文本编码器
├── vae/
│   └── ae.safetensors                       # Flux VAE
├── controlnet/
│   └── instantx-flux-union-controlnet.safetensors
└── loras/
    └── (用户自训练 Flux LoRA)
```

### 必装 ComfyUI 插件

```
custom_nodes/
├── ComfyUI-GGUF/          # GGUF 量化模型加载
└── ComfyUI-RMBG/          # BiRefNet 抠图节点
```

### Flux.1 Schnell 采样参数（固定）

- steps: 4
- cfg: 1.0
- sampler: euler
- scheduler: simple
- denoise: 1.0

### txt2img 核心节点链

```
UnetLoaderGGUF → [LoraLoader] → KSampler
DualCLIPLoader → CLIPTextEncode → KSampler
EmptyLatentImage → KSampler
KSampler → VAEDecode → SaveImage
```

### BiRefNet 抠图节点链

```
LoadImage → BiRefNet → SaveImage (PNG with alpha)
```

## 8. MFlux LoRA 训练

后端通过 `asyncio.create_subprocess_exec` 调用 MFlux CLI：

```bash
mflux-train \
  --model flux.1-schnell \
  --dataset-path /path/to/dataset \
  --output-dir /path/to/output \
  --lora-rank 16 \
  --learning-rate 1e-4 \
  --steps 1000
```

训练完成后自动将 LoRA 文件复制到 `ComfyUI/models/loras/` 目录。

## 9. 移除的组件

- `sd_xl_base_1.0.safetensors` — SDXL 基础模型
- `sdxl_lightning_4step_lora.safetensors` — Lightning LoRA
- LayerDiffusion 相关节点和模型
- 所有 `use_transparency` 相关前后端代码
- 旧版 SDXL 工作流模板（`workflows/txt2img_sdxl_lightning.json`、`workflows/img2img_sdxl_lightning.json`）

## 10. M4 24G 显存预算

| 场景 | 显存占用 | 剩余 |
|------|---------|------|
| Flux.1 Schnell Q5 推理 | ~8-9GB | ~15-16GB |
| + ControlNet Union | +2-3GB | ~12-13GB |
| + LoRA | +0.5-1GB | ~12-14GB |
| BiRefNet 抠图 | ~1-2GB | ~22-23GB |
| MFlux 训练 | ~12-16GB | ~8-12GB |

所有场景均在 24G 内存安全范围内。
