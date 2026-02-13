# 游戏素材生成系统

基于 Flux.1 Schnell + ComfyUI + FastAPI 的游戏 UI / VFX 素材批量生成系统，适配 Apple Silicon (M2/M4)。

## 快速开始

### macOS
```bash
./scripts/macos/start.sh
```

### Windows (PowerShell)
```powershell
.\scripts\windows\start.ps1
```

启动后访问:
- **前端界面**: http://127.0.0.1:8000（生产） / http://127.0.0.1:3000（开发）
- **API 文档**: http://127.0.0.1:8000/docs
- **ComfyUI**: http://127.0.0.1:8188

### 前端开发
```bash
cd frontend
npm install
npm run dev    # 开发服务器 (http://localhost:3000)
npm run build  # 生产构建 (输出到 dist/)
```

## 项目结构

```
AI/
├── scripts/                 # 平台启动脚本
│   ├── macos/               # macOS 脚本 (.sh)
│   └── windows/             # Windows 脚本 (.ps1)
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── main.py          # API 路由
│   │   ├── comfyui_client.py # Flux 工作流构建
│   │   └── task_runner.py   # 生成/抠图/训练执行器
│   └── requirements.txt
├── frontend/                # React + TypeScript 前端
│   ├── src/
│   ├── dist/                # 构建产物
│   └── package.json
├── ComfyUI/                 # 推理引擎
│   └── models/
│       ├── unet/            # Flux.1 Schnell GGUF
│       ├── clip/            # CLIP-L + T5-XXL
│       └── vae/             # Flux VAE
├── outputs/                 # 生成结果
└── docs/plans/              # 设计文档
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Ant Design 6 + Zustand 5 |
| 后端 | FastAPI + SQLite + WebSocket |
| 推理 | ComfyUI + Flux.1 Schnell (GGUF Q5) |
| 抠图 | BiRefNet (ComfyUI-RMBG) |
| ControlNet | Flux.1 ControlNet Union (InstantX) |
| 训练 | MFlux (MLX 原生 LoRA 训练) |
| 加速 | 4步快速出图 (Euler + Simple) |

## 必需模型

| 模型 | 路径 |
|------|------|
| Flux.1 Schnell GGUF | `ComfyUI/models/unet/flux1-schnell-Q5_K_S.gguf` |
| CLIP-L 编码器 | `ComfyUI/models/clip/clip_l.safetensors` |
| T5-XXL 编码器 | `ComfyUI/models/clip/t5xxl_fp16.safetensors` |
| Flux VAE | `ComfyUI/models/vae/ae.safetensors` |
| ControlNet Union (可选) | `ComfyUI/models/controlnet/instantx-flux-union-controlnet.safetensors` |

## 必装 ComfyUI 插件

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/city96/ComfyUI-GGUF.git
git clone https://github.com/1038lab/ComfyUI-RMBG.git
```
