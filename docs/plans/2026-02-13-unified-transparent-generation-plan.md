# 统一透明通道与批量生成实施计划

**日期**: 2026-02-13
**目标**: 实现支持透明通道、ControlNet 控制、批量变体生成的统一系统
**硬件**: Mac mini M2 16GB（效果优先，内存不足可换设备）

---

## 1. 核心决策

1. **默认开启透明通道**：生成的图片默认带 Alpha 通道，适合游戏素材。
2. **统一数据模型**：统一使用 `GenerationTask`，`batch_size` 控制批量变体数量（每帧随机 seed）。
3. **立即集成 ControlNet**：使用 ControlNet Union ProMax 模型，一个模型支持多种控制类型。
4. **数据库清库重建**：不做旧数据迁移，直接删库建新表。
5. **动态工作流构建**：Python 代码动态组装 ComfyUI workflow dict，不再依赖静态 JSON 模板。

---

## 2. 系统架构

### 2.1 统一任务模型

```python
class GenerationTask(Base):
    __tablename__ = "generation_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    style_id: Mapped[int | None] = mapped_column(ForeignKey("styles.id"), nullable=True)
    type: Mapped[str] = mapped_column(default="txt2img")  # txt2img, img2img

    # 核心参数
    prompt: Mapped[str] = mapped_column(Text)
    negative_prompt: Mapped[str] = mapped_column(Text, default="")
    input_image: Mapped[str | None] = mapped_column(String(512), nullable=True)
    seed: Mapped[int | None] = mapped_column(nullable=True)  # 用户可指定，不填则随机

    # 功能参数
    use_transparency: Mapped[bool] = mapped_column(default=True)   # 默认开启透明通道
    batch_size: Mapped[int] = mapped_column(default=1)             # 批量变体数量，每帧随机 seed

    # ControlNet 配置 (JSON 存储)
    controlnet_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # { "enabled": true, "type": "canny", "image": "...", "strength": 0.8 }

    # 状态
    status: Mapped[str] = mapped_column(default="queued")
    # 可选值: queued, running, completed, failed, partial
    # partial = 部分帧生成成功（重试失败后跳过）
    output_paths: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime]
```

**与旧模型的差异**：
- 新增 `negative_prompt`（原来硬编码在 comfyui_client.py 中）
- 新增 `seed`（用户可指定，用于复现结果）
- 新增 `use_transparency`、`batch_size`
- 新增 `controlnet_config`（JSON）
- 删除 `seed_variation`（不做序列帧，批量统一随机 seed）
- `status` 新增 `"partial"` 状态

### 2.2 工作流节点流程

由 `build_universal_workflow()` 函数动态构建，根据参数条件注入节点：

```
[CheckpointLoader] → [LoRA (SDXL Lightning)]
      ↓
[CLIP Text Encode (positive + negative)]
      ↓
[ControlNet Union Apply] ← 可选，当 controlnet.enabled=True 时注入
  ├─ LoadImage (控制图)
  ├─ Preprocessor (Canny/Depth/Scribble/Lineart) ← comfyui_controlnet_aux 插件
  └─ ControlNetUnionLoader + Apply (传入 control_type 整数)
      ↓
[LayerDiffuse Apply] ← 可选，当 use_transparency=True 时注入
      ↓
[KSampler] (4步生成)
      ↓
[VAE Decode]
      ↓
[LayerDiffuse Decode] ← 可选，当 use_transparency=True 时注入（RGBA 解码）
      ↓
[SaveImage] (PNG)
```

**关键点**：
- `use_transparency=False` 时跳过 LayerDiffusion 相关节点，走普通 RGB 流程
- `controlnet.enabled=False` 时跳过 ControlNet 相关节点
- 预处理器在 ComfyUI 工作流内执行（使用 comfyui_controlnet_aux 插件节点）

---

## 3. 后端实施细节

### 3.1 Schema 定义 (`schemas.py`)

```python
class ControlNetConfig(BaseModel):
    enabled: bool = False
    type: Literal["canny", "depth", "scribble", "lineart"]
    image: str | None = None       # 上传控制图的 URL
    strength: float = Field(default=1.0, ge=0.0, le=2.0)

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
```

### 3.2 ControlNet Union 类型映射

```python
# ControlNet Union control_type 映射
CONTROLNET_TYPE_MAP = {
    "canny":    3,  # 细线条类
    "lineart":  3,  # 细线条类
    "depth":    1,  # 深度
    "scribble": 2,  # 粗线条类
}

# 对应 comfyui_controlnet_aux 预处理器节点名
CONTROLNET_PREPROCESSOR_MAP = {
    "canny":    "CannyEdgePreprocessor",
    "lineart":  "LineArtPreprocessor",
    "depth":    "DepthAnythingV2Preprocessor",
    "scribble": "ScribblePreprocessor",
}
```

### 3.3 任务执行器 (`task_runner.py`)

批量循环 + 重试 + 跳过机制：

```python
async def _generation_task_worker(...):
    total = task.batch_size
    success_count = 0
    failed_frames = []

    for i in range(total):
        seed = random.randint(0, 2**32 - 1)

        # 重试机制：最多 3 次
        max_retries = 3
        frame_success = False

        for attempt in range(max_retries):
            try:
                workflow = build_universal_workflow(
                    prompt=task.prompt,
                    negative_prompt=task.negative_prompt,
                    seed=seed,
                    use_transparency=task.use_transparency,
                    controlnet=task.controlnet_config,
                )

                prompt_id = await queue_prompt(workflow)
                await wait_for_completion(prompt_id)

                # 保存结果，命名: {task_id}_{序号}.png
                # ...

                success_count += 1
                frame_success = True
                break

            except Exception as e:
                if attempt < max_retries - 1:
                    await clear_gpu_cache()
                    continue

        if not frame_success:
            failed_frames.append(i)

        # 广播精细进度
        await broadcast_progress({
            "kind": "generation",
            "id": task.id,
            "status": "running",
            "current_frame": i + 1,
            "total_frames": total,
            "frame_progress": 1.0,  # 帧内采样进度（由 ComfyUI WS 回调更新）
            "progress": (i + 1) / total,
        })

        await clear_gpu_cache()

    # 最终状态
    if success_count == total:
        task.status = "completed"
    elif success_count > 0:
        task.status = "partial"
    else:
        task.status = "failed"
```

### 3.4 ComfyUI 客户端 (`comfyui_client.py`)

新增 `build_universal_workflow()` 函数，用 Python dict 动态构建工作流：

```python
def build_universal_workflow(
    prompt: str,
    negative_prompt: str,
    seed: int,
    use_transparency: bool = True,
    controlnet: dict | None = None,
    lora_name: str | None = None,
    width: int = 1024,
    height: int = 1024,
) -> dict:
    """动态构建 ComfyUI workflow dict"""
    workflow = {}
    node_id = 1

    # 1. 基础节点（始终存在）
    #    - CheckpointLoader, LoRA (Lightning), CLIPTextEncode x2
    #    - EmptyLatentImage 或 LoadImage+VAEEncode (img2img)
    #    - KSampler, VAEDecode, SaveImage

    # 2. 条件注入 ControlNet 节点
    if controlnet and controlnet.get("enabled"):
        #    - LoadImage (控制图)
        #    - Preprocessor 节点 (根据 CONTROLNET_PREPROCESSOR_MAP)
        #    - ControlNetUnionLoader (加载 Union ProMax 模型)
        #    - ControlNetApply (传入 control_type 整数, strength)
        pass

    # 3. 条件注入 LayerDiffusion 节点
    if use_transparency:
        #    - LayerDiffuseApply (Attention Injection, 接在 model 输出后)
        #    - LayerDiffuseDecode (替换普通 VAEDecode, 输出 RGBA)
        pass

    return workflow
```

### 3.5 新增 API 端点

```python
# 1. ControlNet 预处理预览
@app.post("/api/controlnet/preview")
async def controlnet_preview(
    image: UploadFile,
    control_type: str = Form(...)  # canny, depth, scribble, lineart
):
    """
    接收原图 + 控制类型，调用 ComfyUI 预处理器节点，返回预处理后的预览图。
    构建一个只包含 LoadImage → Preprocessor → SaveImage 的迷你工作流提交给 ComfyUI。
    """
    pass

# 2. 查询单个任务详情
@app.get("/api/tasks/{task_id}")
async def get_task(task_id: int, session: AsyncSession = Depends(get_session)):
    """返回单个任务详情，包含 current_frame/total_frames 等进度信息"""
    pass
```

### 3.6 WebSocket 进度消息格式（扩展）

```json
{
    "kind": "generation",
    "id": 42,
    "status": "running",
    "current_frame": 3,
    "total_frames": 8,
    "frame_progress": 0.75,
    "progress": 0.34,
    "timestamp": "2026-02-13T10:30:00Z"
}
```

- `current_frame`: 当前正在生成第几张（从 1 开始）
- `total_frames`: 总共要生成几张
- `frame_progress`: 当前帧的采样进度（0.0 - 1.0，来自 ComfyUI WS 回调）
- `progress`: 总进度百分比

---

## 4. 前端实施细节

### 4.1 TypeScript 类型定义更新 (`types/generation.ts`)

```typescript
// 新增
interface ControlNetConfig {
    enabled: boolean;
    type: 'canny' | 'depth' | 'scribble' | 'lineart';
    image: string | null;
    strength: number;
}

// 更新 GenerationTask
interface GenerationTask {
    id: number;
    style_id: number | null;
    type: GenerationType;
    prompt: string;
    negative_prompt: string;       // 新增
    input_image: string | null;
    seed: number | null;           // 新增
    use_transparency: boolean;     // 新增
    batch_size: number;            // 新增
    controlnet_config: ControlNetConfig | null;  // 新增
    status: 'queued' | 'running' | 'completed' | 'failed' | 'partial';  // 新增 partial
    output_paths: string[];
    created_at: string;
}

// 更新 WSProgressMessage
interface WSProgressMessage {
    kind: 'generation' | 'training';
    id: number;
    status: string;
    progress?: number;
    current_frame?: number;        // 新增
    total_frames?: number;         // 新增
    frame_progress?: number;       // 新增
    output_paths?: string[];
    timestamp?: string;
}

// 新增：提交参数
interface GenerationSubmitPayload {
    style_id: number | null;
    type: GenerationType;
    prompt: string;
    negative_prompt: string;
    input_image: string | null;
    seed: number | null;
    use_transparency: boolean;
    batch_size: number;
    controlnet: ControlNetConfig | null;
}
```

### 4.2 界面改造 (`GenerationPanel.tsx`)

**改造现有控件**：
- "生成数量"滑块（1-10）改为 `batch_size`（1-32），语义为"批量变体数量"

**新增控件**：
1. **透明通道开关**: `Switch` 组件，默认开启
2. **Negative Prompt**: `TextArea` 输入框，提供默认值，可折叠
3. **Seed 输入**: `InputNumber`，可选填，不填则随机
4. **ControlNet 折叠面板** (`Collapse`):
   - 开关: `Switch` 启用/禁用
   - 类型选择: `Select` — Canny（边缘）、Depth（深度）、Scribble（涂鸦）、Lineart（线稿）
   - 控制图上传: `Upload.Dragger`
   - **预处理预览**: 上传后调用 `/api/controlnet/preview` 显示预处理效果图
   - 强度滑块: `Slider` 0.0 - 2.0

### 4.3 结果展示

- **透明图片**（`use_transparency=true`）：使用**棋盘格背景**展示，清晰显示透明区域
- **非透明图片**（`use_transparency=false`）：使用**普通深色背景**展示
- 批量任务：显示网格列表，支持批量 ZIP 下载
- 输出文件命名：`{task_id}_{序号}.png`，按任务 ID 分组

### 4.4 进度展示

批量生成时显示精细进度：
- 文字: "生成中 3/8"（当前帧/总帧数）
- 进度条: 显示总进度百分比
- 帧内进度: 显示当前帧的采样进度

### 4.5 状态管理 (`generationStore.ts`)

更新 `submitGeneration` 方法，传递完整参数：
- `negative_prompt`, `seed`, `use_transparency`, `batch_size`, `controlnet`

新增 ControlNet 预览方法：
- `previewControlNet(image, type)` → 调用 `/api/controlnet/preview`

---

## 5. 依赖与环境

### 5.1 ComfyUI 插件安装

```bash
cd ComfyUI/custom_nodes

# LayerDiffusion（透明通道）
git clone https://github.com/huchenlei/ComfyUI-layerdiffuse.git
cd ComfyUI-layerdiffuse && pip install -r requirements.txt && cd ..

# ControlNet Aux（预处理器：Canny/Depth/Scribble/Lineart 等）
git clone https://github.com/Fannovel16/comfyui_controlnet_aux.git
cd comfyui_controlnet_aux && pip install -r requirements.txt && cd ..
```

### 5.2 模型下载

| 模型 | 路径 | 大小 | 来源 |
|------|------|------|------|
| LayerDiffusion (attn) | `models/layer_model/layer_xl_transparent_attn.safetensors` | 709 MB | 首次使用自动下载 |
| LayerDiffusion (conv) | `models/layer_model/layer_xl_transparent_conv.safetensors` | 3.37 GB | 首次使用自动下载 |
| **ControlNet Union ProMax** | `models/controlnet/diffusion_pytorch_model_promax.safetensors` | 2.51 GB | [xinsir/controlnet-union-sdxl-1.0](https://huggingface.co/xinsir/controlnet-union-sdxl-1.0) |

**注意**：只需下载 Union ProMax 一个 ControlNet 模型文件，即可支持 Canny、Depth、Scribble、Lineart 等所有控制类型。

### 5.3 内存估算

| 组件 | 估算内存 |
|------|---------|
| SDXL Base (fp16) | ~6.5 GB |
| SDXL Lightning LoRA | ~0.2 GB |
| LayerDiffusion (attn) | ~0.7 GB |
| ControlNet Union ProMax | ~2.5 GB |
| VAE + CLIP | ~1.5 GB |
| **合计** | **~11.4 GB** |

M2 16GB 统一内存，预计可以运行但余量不大。如遇内存不足，可升级设备。

---

## 6. 执行步骤

### Phase 0.1: 后端基础
- 清库，更新 `models.py`（新增字段、新增 partial 状态）
- 更新 `schemas.py`（ControlNetConfig、negative_prompt、seed 等）
- 新增 API: `POST /api/controlnet/preview`、`GET /api/tasks/{task_id}`

### Phase 0.2: ComfyUI 集成
- 安装 ComfyUI-layerdiffuse 和 comfyui_controlnet_aux 插件
- 下载 ControlNet Union ProMax 模型
- 实现 `build_universal_workflow()` 动态工作流构建函数
- 实现 ControlNet 预处理预览的迷你工作流

### Phase 0.3: 任务执行器升级
- 升级 `task_runner.py`：批量循环 + 重试 3 次 + 跳过 + partial 状态
- 扩展 WebSocket 进度消息格式（current_frame、total_frames、frame_progress）
- 输出文件命名 `{task_id}_{序号}.png`

### Phase 0.4: 前端升级
- 更新 TypeScript 类型定义
- 改造 GenerationPanel：透明开关、negative prompt、seed、batch_size、ControlNet 面板
- ControlNet 预处理预览功能
- 结果展示：棋盘格背景（透明图）/ 普通背景（非透明图）
- 精细进度展示（当前帧/总帧 + 帧内进度）

### Phase 0.5: 测试与优化
- 测试 M2 16GB 下的内存表现
- 测试各 ControlNet 类型的预处理和生成效果
- 测试批量生成的重试和 partial 状态逻辑
- 验证透明通道输出质量
- 优化内存清理逻辑

---

## 7. 不在本计划范围内

- **序列帧动画**：AnimateDiff 等方案无法与 LayerDiffusion 透明通道兼容，作为独立后续计划
- **训练功能**：当前保持模拟状态，不在本次改动范围
- **旧数据兼容**：直接清库，不做迁移
