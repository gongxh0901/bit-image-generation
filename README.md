# 游戏素材生成系统

基于 SDXL + ComfyUI + FastAPI 的游戏 UI / VFX 素材批量生成系统，适配 Mac mini M2。

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
│   │   ├── start.sh
│   │   ├── stop.sh
│   │   └── deploy.sh
│   └── windows/             # Windows 脚本 (.ps1)
│       ├── start.ps1
│       ├── stop.ps1
│       └── deploy.ps1
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── main.py
│   │   ├── comfyui_client.py
│   │   ├── task_runner.py
│   │   └── workflows/       # ComfyUI 工作流模板
│   └── requirements.txt
├── frontend/                # React + TypeScript 前端
│   ├── src/                 # 源代码
│   ├── dist/                # 构建产物
│   └── package.json
├── ComfyUI/                 # 推理引擎
│   └── models/
│       ├── checkpoints/     # SDXL base
│       └── loras/           # SDXL Lightning
├── outputs/                 # 生成结果
└── docs/plans/              # 设计文档
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Ant Design 5 + Zustand |
| 后端 | FastAPI + SQLite + WebSocket |
| 推理 | ComfyUI + SDXL + Lightning LoRA |
| 加速 | 4步快速生成 (SDXL Lightning) |

## 模型

| 模型 | 路径 |
|------|------|
| SDXL Base 1.0 | `ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors` |
| SDXL Lightning 4-step | `ComfyUI/models/loras/sdxl_lightning_4step_lora.safetensors` |
