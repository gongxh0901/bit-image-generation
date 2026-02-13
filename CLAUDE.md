# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

游戏素材生成系统 — 基于 SDXL + ComfyUI + FastAPI 的游戏 UI/VFX 素材批量生成平台，适配 Mac mini M2。支持 txt2img、img2img、透明通道（LayerDiffusion）、ControlNet、LoRA 训练与风格管理。

## 常用命令

### 前端（frontend/）
```bash
cd frontend && npm install        # 安装依赖
cd frontend && npm run dev        # 开发服务器 http://localhost:3000
cd frontend && npm run build      # 生产构建（tsc + vite，输出到 dist/）
cd frontend && npm run lint       # ESLint 检查
```

### 后端（backend/）
```bash
source backend/.venv/bin/activate               # 激活虚拟环境
pip install -r backend/requirements.txt         # 安装依赖
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # 在 backend/ 目录下运行
```

### 一键启动（ComfyUI + 后端 + 前端）
```bash
./scripts/macos/start.sh      # macOS
.\scripts\windows\start.ps1   # Windows
```

## 架构

```
前端 (React/TS, :3000)  ←→  后端 (FastAPI, :8000)  ←→  ComfyUI (:8188)
       Vite 代理               SQLite + WebSocket        SDXL + Lightning LoRA
```

三个服务独立运行。开发时前端通过 Vite 代理将 `/api`、`/ws`、`/outputs` 转发到后端；生产时后端直接托管 `frontend/dist/` 静态文件。

### 后端（backend/app/）

| 文件 | 职责 |
|------|------|
| `main.py` | FastAPI 应用入口、所有 API 路由、静态文件托管、启动时数据库迁移 |
| `models.py` | SQLAlchemy ORM 模型（Style、GenerationTask、TrainingJob、Dataset） |
| `schemas.py` | Pydantic 请求/响应模式定义 |
| `database.py` | 异步 SQLAlchemy 引擎、会话工厂 |
| `comfyui_client.py` | ComfyUI REST/WebSocket 客户端、工作流构建 |
| `task_runner.py` | 后台任务执行（生成、训练），通过 `asyncio.create_task` 触发 |
| `progress.py` | WebSocket 进度广播中心，向前端推送任务进度 |
| `workflows/` | ComfyUI JSON 工作流模板 |

数据库使用 SQLite（异步驱动），启动时自动建表和列迁移（`_migrate_columns`）。无需手动执行迁移命令。

### 前端（frontend/src/）

| 目录 | 职责 |
|------|------|
| `pages/Home/` | 主页 — 生成面板 + 结果画廊 |
| `pages/Training/` | LoRA 训练界面 |
| `pages/History/` | 任务历史 |
| `stores/` | Zustand 状态管理（generationStore、styleStore、taskStore、trainingStore） |
| `services/` | Axios API 封装（generation、style、training、task、upload） |
| `hooks/useWebSocket.ts` | 全局 WebSocket 连接，监听 `/ws/progress` 实时进度 |
| `theme/` | Ant Design 暗色主题配置 |
| `types/` | TypeScript 类型定义 |

路径别名：`@/` 映射到 `src/`。路由使用 React Router v7 + 懒加载。

## 关键约定

### API 路由格式
- REST 接口：`/api/styles`、`/api/generate`、`/api/training`、`/api/tasks`、`/api/upload`
- WebSocket 进度推送：`/ws/progress`
- 静态文件访问：`/outputs/...`、`/uploads/...`

### WebSocket 消息格式
```json
{
  "kind": "generation | training",
  "id": "任务ID",
  "status": "running | completed | failed | partial",
  "progress": 0.0,
  "output_paths": []
}
```

### 数据库会话模式
```python
async with AsyncSessionLocal() as session:
    result = await session.execute(select(Model).where(...))
    item = result.scalar_one_or_none()
```

### 后台任务模式
生成和训练任务通过 `asyncio.create_task()` 异步触发执行，在 `task_runner.py` 中通过 `ProgressHub.broadcast()` 推送进度。

### 环境变量
- `COMFYUI_URL` — ComfyUI 地址（默认 `http://127.0.0.1:8188`）
- `DATABASE_URL` — 数据库连接字符串（默认 `sqlite+aiosqlite:///./game_asset_generator.db`）

### 必需模型文件
- `ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors`
- `ComfyUI/models/loras/sdxl_lightning_4step_lora.safetensors`

## 修改后必须检查的文件

每次修改代码后，必须逐一检查以下文件是否需要同步更新：

### 1. 文档文件
- `CLAUDE.md` — 本文件。架构、命令、约定发生变化时必须更新
- `README.md` — 项目根目录说明文档。技术栈、项目结构、启动方式变化时必须更新
- `backend/README.md` — 后端说明文档。API 接口、目录结构变化时必须更新
- `frontend/README.md` — 前端说明文档（当前为 Vite 模板默认内容，如有自定义内容需同步维护）

### 2. 部署与启动脚本（scripts/）
- `scripts/macos/start.sh` — macOS 启动脚本
- `scripts/macos/stop.sh` — macOS 停止脚本
- `scripts/macos/deploy.sh` — macOS 部署脚本
- `scripts/windows/start.ps1` — Windows 启动脚本
- `scripts/windows/stop.ps1` — Windows 停止脚本
- `scripts/windows/deploy.ps1` — Windows 部署脚本

涉及以下变更时，macOS 和 Windows 脚本必须同步更新：
- 新增或修改依赖（requirements.txt、package.json）
- 端口号变化
- 新增服务或进程
- 环境变量变化
- 目录结构调整

## 注意事项

- Python 版本要求 3.10+（ComfyUI 依赖）
- 当前后端和前端均无测试套件
- SQLite 列迁移在 `main.py` 的 `_migrate_columns()` 中手动处理，添加新列时需在该函数中追加迁移定义
- `ComfyUI/` 目录是外部依赖，不属于本项目代码，不要修改其内容
- 交流和注释语言偏好：中文
