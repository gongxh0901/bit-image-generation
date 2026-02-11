# 游戏素材生成系统

基于 SDXL + ComfyUI + FastAPI 的游戏 UI / VFX 素材批量生成系统，适配 Mac mini M2。

## 快速开始

```bash
./start.sh
```

启动后访问:
- **前端界面**: http://127.0.0.1:8000
- **API 文档**: http://127.0.0.1:8000/docs
- **ComfyUI**: http://127.0.0.1:8188

## 项目结构

```
AI/
├── start.sh                 # 一键启动脚本
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── main.py
│   │   ├── comfyui_client.py
│   │   ├── task_runner.py
│   │   └── workflows/       # ComfyUI 工作流模板
│   └── requirements.txt
├── frontend/                # Web 前端 (静态页面)
│   └── index.html
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
| 前端 | 原生 HTML/JS (暗色主题) |
| 后端 | FastAPI + SQLite + WebSocket |
| 推理 | ComfyUI + SDXL + Lightning LoRA |
| 加速 | 4步快速生成 (SDXL Lightning) |

## 模型

| 模型 | 路径 |
|------|------|
| SDXL Base 1.0 | `ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors` |
| SDXL Lightning 4-step | `ComfyUI/models/loras/sdxl_lightning_4step_lora.safetensors` |
