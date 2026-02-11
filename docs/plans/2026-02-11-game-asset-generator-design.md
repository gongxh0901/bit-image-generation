# 游戏素材生成系统设计方案

**日期**: 2026-02-11
**设备**: Mac mini M2 (16GB)
**用途**: 批量生成游戏UI和游戏特效素材

---

## 1. 系统架构

### 技术栈

| 层级 | 技术选型 | 理由 |
|------|---------|------|
| 前端 | React / Vue | 用户友好的Web管理界面 |
| 后端 | FastAPI | 轻量异步，支持REST + WebSocket |
| 数据库 | SQLite | 轻量，无需额外服务 |
| 推理引擎 | ComfyUI | Apple Silicon原生支持，API友好 |
| 训练框架 | Kohya_ss GUI | M2优化，LoRA/LyCORIS支持 |
| 基础模型 | SDXL + SDXL Lightning | 生态成熟，M2运行流畅 |

### 架构图

```
┌─────────────────────────────────────────┐
│           Frontend (React/Vue)          │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐ │
│  │风格管理 │ │训练中心 │ │ 生成中心  │ │
│  └─────────┘ └─────────┘ └───────────┘ │
└──────────────┬──────────────────────────┘
               │ REST API
┌──────────────▼──────────────────────────┐
│           Backend (FastAPI)             │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐ │
│  │风格服务 │ │训练服务 │ │ 生成服务  │ │
│  └─────────┘ └─────────┘ └───────────┘ │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌───────┐ ┌────────┐ ┌──────────┐
│SQLite │ │ComfyUI │ │Model文件 │
└───────┘ │服务    │ └──────────┘
          └────────┘
```

---

## 2. 数据库模型

```sql
-- 风格/模型表
styles: id, name, type(ui|vfx), lora_path, trigger_words, preview_image, created_at

-- 训练任务表
training_jobs: id, style_id, dataset_path, status, params, progress, created_at

-- 生成任务表
generation_tasks: id, style_id, type(txt2img|img2img), prompt, status, output_paths, created_at

-- 数据集表
datasets: id, name, image_count, tag_count, path, created_at
```

---

## 3. API设计

```
GET    /api/styles           # 获取所有风格
POST   /api/styles           # 创建新风格
POST   /api/training         # 启动训练任务
GET    /api/training/{id}    # 查询训练进度
POST   /api/generate         # 提交生成任务
GET    /api/tasks            # 获取任务列表
WS     /ws/progress          # WebSocket实时进度
```

---

## 4. 推荐模型清单

### 主模型 (Checkpoint)

| 模型 | 文件大小 | 显存占用 | 适用场景 |
|------|---------|---------|---------|
| **Juggernaut XL** | 6.5GB | ~6GB | 写实/游戏UI/特效 |
| **DreamShaper v8** | 4GB | ~4GB | 通用型 |

### 加速LoRA

| LoRA | 文件大小 | 作用 |
|------|---------|------|
| **SDXL Lightning 4-step** | 375MB | 4步快速生成 |
| **Better Picture Details** | 218MB | 增强细节 |

### ControlNet

| 模型 | 用途 |
|------|------|
| **control_v11f1p_sd15_depth** | 深度控制 |
| **control_v11f1p_sd15_canny** | 边缘控制 |

---

## 5. 训练流程

### 数据准备

1. 收集10-50张参考图
2. BLIP自动标注
3. 手动校正关键标签

### 预处理

- 统一分辨率: 1024x1024
- 镜像翻转 (数据增强)
- 裁剪边缘留白

### 训练参数 (M2优化)

```yaml
batch_size: 1-2
learning_rate: 1e-4
max_train_steps: 1000-2000
resolution: 1024
混合精度: fp16
```

### 训练时长

约15-30分钟 (50张图，1000步)

---

## 6. 落地步骤

### 步骤1: 环境准备 (10分钟)

```bash
# 安装 Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装 Python 3.11
brew install python@3.11

# 安装 Git
brew install git
```

### 步骤2: 安装 ComfyUI (15分钟)

```bash
# 克隆仓库
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI

# 创建虚拟环境
python3.11 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 步骤3: 下载模型

```bash
# 创建模型目录
mkdir -p models/checkpoint
mkdir -p models/loras
mkdir -p models/controlnet

# 下载主模型 (示例)
cd models/checkpoint
curl -L -o Juggernaut_XL.safetensors "https://civitai.com/api/download?modelId=114685"

# 下载 LoRA
cd ../loras
curl -L -o sdxl_lightning_4step.safetensors "https://civitai.com/api/download?type=LoRA&modelId=253693"
```

### 步骤4: 部署 Web 系统

```bash
# 后端
mkdir backend
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn sqlalchemy aiosqlite

# 前端 (React示例)
cd ../frontend
npm create vite@latest . -- --template react
npm install axios socket.io-client
```

---

## 7. 每日使用量

- 生成数量: 按需，每日不超过50张
- 训练频率: 按需
- 目标风格: 卡通/奇幻/未来 (通过LoRA训练实现)

---

## 8. 待办

- [ ] 环境准备
- [ ] ComfyUI安装配置
- [ ] 模型下载
- [ ] Web系统前后端开发
- [ ] LoRA训练流程测试
- [ ] 批量生成工作流测试
