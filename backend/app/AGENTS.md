# BACKEND APP KNOWLEDGE BASE

**Scope**: FastAPI 应用核心代码 (`backend/app/`)

## OVERVIEW
异步 FastAPI 应用，处理风格管理、训练任务、图片生成。通过 ComfyUI API 调用 SDXL 模型。

## STRUCTURE

```
backend/app/
├── main.py              # FastAPI 实例 + 路由
├── database.py          # SQLAlchemy 异步引擎配置
├── models.py            # ORM 实体（Style, TrainingJob, GenerationTask, Dataset）
├── schemas.py           # Pydantic 模型
├── progress.py          # WebSocket 连接管理器
├── comfyui_client.py    # ComfyUI REST/WebSocket 客户端
├── task_runner.py       # 后台任务执行器
└── workflows/           # ComfyUI 工作流模板
    ├── txt2img_sdxl_lightning.json
    └── img2img_sdxl_lightning.json
```

## WHERE TO LOOK

| Task | File | Function/Class |
|------|------|----------------|
| 添加 API 端点 | `main.py` | `app.get/post/websocket` |
| 修改数据库结构 | `models.py` | SQLAlchemy 类定义 |
| 调整请求校验 | `schemas.py` | Pydantic BaseModel |
| ComfyUI 通信 | `comfyui_client.py` | `queue_prompt()`, `wait_for_completion()` |
| 自定义工作流 | `workflows/*.json` | 修改模板 + `build_*_prompt()` |
| 进度推送 | `progress.py` | `ProgressHub.broadcast()` |
| 任务逻辑 | `task_runner.py` | `_generation_task_worker()` |

## CONVENTIONS

### Import Order
1. 标准库
2. 第三方包 (`fastapi`, `sqlalchemy`, `aiohttp`)
3. 应用模块 (`from app.xxx import ...`)

### Database Session
```python
async with session_maker() as session:
    result = await session.execute(select(Model).where(...))
    item = result.scalar_one_or_none()
```

### WebSocket 消息格式
```python
{
    "kind": "generation|training",
    "id": task_id,
    "status": "running|completed|failed",
    "progress": float,  # 0-100
    "timestamp": "2026-02-12T10:30:00+00:00"
}
```

### 错误处理
- 数据库: `scalar_one_or_none()` + `if not item: return`
- API: `HTTPException(status_code=404, detail="...")`
- 任务: try/except + `logger.exception()` + 广播 failed 状态

## ANTI-PATTERNS

| Don't | Do Instead |
|-------|------------|
| `session.commit()` 后访问 lazy load | `await session.refresh(item)` |
| 同步 `requests` | `aiohttp.ClientSession` |
| 直接 `json.dumps()` 工作流 | `_fill_template()` 处理占位符 |
| 忽略 WebSocket 断开 | 捕获异常并从 `_connections` 移除 |

## DEPENDENCIES

```
fastapi
uvicorn[standard]
sqlalchemy[asyncio]
aiosqlite
greenlet  # SQLAlchemy async 需要
pydantic
aiohttp   # ComfyUI 通信
python-multipart  # 文件上传 (POST /api/upload)
```

## KEY IMPLEMENTATIONS

### Task Runner Pattern
Fire-and-forget via `asyncio.create_task()`:
```python
def run_generation_task(...):
    asyncio.create_task(_generation_task_worker(...))
```

### ComfyUI Workflow Template
JSON 使用 `{{key}}` 占位符，运行时 `_fill_template()` 替换。

### Progress Broadcasting
`ProgressHub` 持有 WebSocket 连接集合，任务通过它广播进度。

## NOTES

- **会话管理**: 每个 worker 独立创建 `AsyncSession`，避免跨协程共享
- **图片输出**: 从 `ComfyUI/output/` 复制到项目 `outputs/`，路径转为 `/outputs/{filename}`
- **参考图上传**: 上传文件保存到 `uploads/`，img2img 时复制到 ComfyUI input 并使用真实路径
- **基础风格**: 启动时自动创建「基础风格」（`is_base=True`），不可删除，使用 SDXL Base 无自定义 LoRA
- **数据库迁移**: `_migrate_columns()` 在启动时检查并添加新列到现有 SQLite 表
- **超时**: `wait_for_completion()` 默认 300 秒
- **环境**: `COMFYUI_URL` 默认 `http://127.0.0.1:8188`
