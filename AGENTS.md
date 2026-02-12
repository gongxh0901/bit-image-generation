# PROJECT KNOWLEDGE BASE

**Project**: 游戏素材生成系统 (Game Asset Generator)  
**Generated**: 2026-02-12  
**Commit**: 51e078c  
**Branch**: main  

## ⚠️ IMPORTANT RULE

> **文档同步规则**: 当项目代码发生任何改动后，必须检查改动内容。如果改动涉及以下内容，**必须同步更新**相关文档：
> - 新增/修改/删除 API 端点 → 更新本文件和 `README.md`
> - 数据库模型变更 → 更新本文件中的 STRUCTURE 和 CONVENTIONS
> - 新增依赖或配置文件 → 更新本文件和 `README.md`
> - 项目结构变化 → 更新所有 AGENTS.md 文件
> - 反模式或规范变化 → 更新本文件的 CONVENTIONS 和 ANTI-PATTERNS

## OVERVIEW
基于 SDXL + ComfyUI + FastAPI 的游戏 UI/VFX 素材批量生成系统，适配 Mac mini M2。

**Core Stack**: React + TypeScript + Ant Design 5 | FastAPI (async) + SQLAlchemy + ComfyUI + SDXL Lightning

## STRUCTURE

```
.
├── scripts/              # 平台启动脚本
│   ├── macos/            # macOS 脚本 (.sh)
│   │   ├── start.sh
│   │   ├── stop.sh
│   │   └── deploy.sh
│   └── windows/          # Windows 脚本 (.ps1)
│       ├── start.ps1
│       ├── stop.ps1
│       └── deploy.ps1
├── backend/              # FastAPI 后端
│   ├── app/              # 应用代码
│   ├── requirements.txt
│   └── README.md
├── frontend/             # React + TypeScript 前端
│   ├── src/              # 源代码
│   │   ├── components/   # 公共组件（Layout 等）
│   │   ├── pages/        # 页面（Home, Training）
│   │   ├── stores/       # Zustand 状态管理
│   │   ├── hooks/        # 自定义 Hooks
│   │   ├── services/     # API 服务层
│   │   ├── types/        # TypeScript 类型
│   │   ├── utils/        # 工具函数
│   │   └── theme/        # Ant Design 暗色主题
│   ├── dist/             # 构建产物
│   └── package.json
├── ComfyUI/              # 推理引擎（外部依赖）
├── outputs/              # 生成结果目录
└── docs/plans/           # 设计文档
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| API 路由 | `backend/app/main.py` | FastAPI 入口，所有 REST/WS 端点 |
| 数据库模型 | `backend/app/models.py` | SQLAlchemy ORM，4 个实体 |
| Pydantic 校验 | `backend/app/schemas.py` | 请求/响应模型 |
| ComfyUI 通信 | `backend/app/comfyui_client.py` | 工作流提交、WebSocket 监听 |
| 异步任务 | `backend/app/task_runner.py` | 训练和生成任务执行器 |
| 实时进度 | `backend/app/progress.py` | WebSocket 广播中心 |
| 工作流模板 | `backend/app/workflows/` | txt2img/img2img JSON |
| 前端页面 | `frontend/src/pages/` | Home（三栏工作台）+ Training（训练中心） |
| 前端组件 | `frontend/src/components/` | Layout、Header 等公共组件 |
| 前端状态 | `frontend/src/stores/` | Zustand: style/generation/training |
| 前端 API | `frontend/src/services/` | Axios 封装的后端接口 |

## CONVENTIONS

### Python (Backend)
- **Async-first**: 使用 `async/await`，SQLAlchemy `AsyncSession`
- **Type hints**: 全项目类型注解（Python 3.10+ 语法）
- **Models**: SQLAlchemy 2.0 风格，使用 `Mapped[]` 和 `mapped_column()`
- **Schemas**: Pydantic v2，`Config.from_attributes = True`
- **Imports**: 绝对导入 `from app.models import ...`
- **Time**: UTC 时间，`datetime.now(timezone.utc)`

### Database
- SQLite + aiosqlite（开发）
- JSON 字段存储可变参数（`params`, `output_paths`）
- 外键关联：`style_id` 可选（可空）

### API Patterns
- Fire-and-forget: `POST /api/generate` 立即返回，后台执行
- WebSocket 进度：`/ws/progress` 推送实时状态
- 静态文件：`/outputs/` 托管生成图片

### Shell Scripts (macOS)
- `set -euo pipefail` 严格模式
- 颜色输出（部署脚本）
- 自动检测 Python 版本（3.10+）

### PowerShell Scripts (Windows)
- `$ErrorActionPreference = "Stop"` 错误处理
- BITS/Invoke-WebRequest 下载（支持断点续传）
- 颜色输出函数
- 端口占用检测与强制结束

## ANTI-PATTERNS (THIS PROJECT)

| Don't | Reason |
|-------|--------|
| 阻塞数据库操作 | 使用 `async with session.begin()` |
| 同步 HTTP 请求 | 使用 `aiohttp` |
| 直接操作 `ComfyUI/output/` | 通过 `task_runner.py` 复制到 `outputs/` |
| 训练任务真实执行 | 当前为模拟实现（TODO: Kohya_ss 集成）|

## UNIQUE STYLES

- **中文注释**: 代码和文档使用中文
- **环境变量**: `COMFYUI_URL`, `DATABASE_URL` 可配置
- **模板工作流**: ComfyUI JSON 使用 `{{placeholder}}` 占位符替换
- **单文件前端**: 零构建工具，纯 HTML/CSS/JS

## COMMANDS

### macOS

```bash
# 部署（首次）
./scripts/macos/deploy.sh

# 启动
./scripts/macos/start.sh

# 停止
./scripts/macos/stop.sh

# 手动启动后端
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload
```

### Windows (PowerShell)

```powershell
# 部署（首次）
.\scripts\windows\deploy.ps1

# 启动
.\scripts\windows\start.ps1

# 停止
.\scripts\windows\stop.ps1

# 注意: 首次运行 PowerShell 脚本前可能需要设置执行策略
# Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 手动启动后端
cd backend
.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

## ARCHITECTURE

```
前端 (8000) ←→ FastAPI (8000) ←→ ComfyUI (8188)
                     ↓
               SQLite DB
```

**Port Mapping**:
- `8000`: FastAPI + 前端静态文件
- `8188`: ComfyUI 推理服务

## NOTES

- **模型路径**: `ComfyUI/models/checkpoints/` 和 `loras/`
- **输出路径**: 生成图片自动复制到 `outputs/` 并可通过 `/outputs/{filename}` 访问
- **训练模拟**: `_training_job_worker` 目前仅模拟进度，真实训练需集成 Kohya_ss
- **img2img 限制**: `input_image` 参数为占位符，真实实现需文件上传
