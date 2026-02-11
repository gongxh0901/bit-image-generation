# Game Asset Generator Backend

基于 FastAPI + SQLite + ComfyUI 的游戏素材生成系统后端。

## 架构

```
前端 (8000/) ←→ FastAPI 后端 (8000) ←→ ComfyUI 推理 (8188)
                    ↓
                 SQLite DB
```

## 已实现接口

- `GET /health` — 系统状态 + ComfyUI 连通性
- `GET /api/styles` / `POST /api/styles` — 风格管理
- `POST /api/training` / `GET /api/training/{id}` — 训练任务
- `POST /api/generate` — 提交生成任务（真实调用 ComfyUI）
- `GET /api/tasks` — 任务列表
- `WS /ws/progress` — WebSocket 实时进度
- `GET /outputs/{filename}` — 生成图片静态文件

## 目录结构

```
backend/
├── app/
│   ├── main.py             # FastAPI 入口
│   ├── database.py         # 异步 SQLite
│   ├── models.py           # ORM 模型
│   ├── schemas.py          # Pydantic 验证
│   ├── progress.py         # WebSocket 广播
│   ├── comfyui_client.py   # ComfyUI API 客户端
│   ├── task_runner.py      # 异步任务执行器
│   └── workflows/
│       ├── txt2img_sdxl_lightning.json
│       └── img2img_sdxl_lightning.json
└── requirements.txt
```
