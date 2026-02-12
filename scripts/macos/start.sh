#!/usr/bin/env bash
set -euo pipefail

# ============================================
#  游戏素材生成系统 — 一键启动脚本
#  同时启动 ComfyUI (8188) + FastAPI 后端 (8000)
# ============================================

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
COMFYUI_DIR="$ROOT_DIR/ComfyUI"
BACKEND_VENV="$BACKEND_DIR/.venv"
COMFYUI_VENV="$COMFYUI_DIR/venv"

# Cleanup on exit
cleanup() {
  echo ""
  echo "→ 正在关闭服务 …"
  [ -n "${COMFYUI_PID:-}" ] && kill "$COMFYUI_PID" 2>/dev/null || true
  [ -n "${BACKEND_PID:-}" ] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null
  echo "✔ 已停止"
}
trap cleanup EXIT INT TERM

echo "========================================"
echo "  游戏素材生成系统 — 启动中 …"
echo "========================================"

# ---------- 1. 检查 Python (>= 3.10) ----------
PYTHON=""
for cmd in python3.12 python3.11 python3.10 python3 python; do
  if command -v "$cmd" &>/dev/null; then
    PY_MINOR=$($cmd -c 'import sys; print(sys.version_info.minor)')
    PY_MAJOR=$($cmd -c 'import sys; print(sys.version_info.major)')
    if [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -ge 10 ]; then
      PYTHON="$cmd"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "❌ 找不到 Python 3.10+，请先安装"
  echo "   当前系统 Python 版本过低，ComfyUI 要求 Python >= 3.10"
  echo "   推荐安装: brew install python@3.11"
  exit 1
fi

PY_VER=$($PYTHON -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "✔ 使用 Python: $PYTHON ($PY_VER)"

# ---------- 辅助: 检查虚拟环境 Python 版本是否匹配 ----------
check_venv_python() {
  local venv_dir="$1"
  local label="$2"
  if [ -d "$venv_dir" ]; then
    VENV_PY_VER=$("$venv_dir/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "unknown")
    if [ "$VENV_PY_VER" != "$PY_VER" ]; then
      echo "⚠️  $label 虚拟环境 Python 版本不匹配 ($VENV_PY_VER → $PY_VER)，重新创建 …"
      rm -rf "$venv_dir"
    fi
  fi
}

# ---------- 2. 后端虚拟环境 ----------
check_venv_python "$BACKEND_VENV" "后端"
if [ ! -d "$BACKEND_VENV" ]; then
  echo "→ 创建后端虚拟环境 …"
  $PYTHON -m venv "$BACKEND_VENV"
fi
source "$BACKEND_VENV/bin/activate"
echo "→ 安装后端依赖 …"
pip install --quiet --upgrade pip
pip install --quiet -r "$BACKEND_DIR/requirements.txt"
deactivate
echo "✔ 后端依赖就绪"

# ---------- 3. 检查 ComfyUI ----------
if [ ! -d "$COMFYUI_DIR" ]; then
  echo "❌ ComfyUI 目录不存在: $COMFYUI_DIR"
  echo "   请先运行: git clone https://github.com/comfyanonymous/ComfyUI.git"
  exit 1
fi

check_venv_python "$COMFYUI_VENV" "ComfyUI"
if [ ! -d "$COMFYUI_VENV" ]; then
  echo "→ 创建 ComfyUI 虚拟环境 …"
  $PYTHON -m venv "$COMFYUI_VENV"
  source "$COMFYUI_VENV/bin/activate"
  pip install --quiet --upgrade pip
  pip install --quiet -r "$COMFYUI_DIR/requirements.txt"
  deactivate
fi
echo "✔ ComfyUI 环境就绪"

# ---------- 4. 检查模型 ----------
CKPT_DIR="$COMFYUI_DIR/models/checkpoints"
LORA_DIR="$COMFYUI_DIR/models/loras"

if [ ! -f "$CKPT_DIR/sd_xl_base_1.0.safetensors" ]; then
  echo "⚠️  未找到 SDXL 基础模型，请下载到: $CKPT_DIR/sd_xl_base_1.0.safetensors"
fi
if [ ! -f "$LORA_DIR/sdxl_lightning_4step_lora.safetensors" ]; then
  echo "⚠️  未找到 SDXL Lightning LoRA，请下载到: $LORA_DIR/sdxl_lightning_4step_lora.safetensors"
fi

# ---------- 5. 创建 outputs 目录 ----------
mkdir -p "$ROOT_DIR/outputs"

# ---------- 6. 启动 ComfyUI ----------
echo ""
echo "→ 启动 ComfyUI (端口 8188) …"
(
  cd "$COMFYUI_DIR"
  source venv/bin/activate
  exec python main.py --listen 0.0.0.0 --port 8188 --force-fp16
) &
COMFYUI_PID=$!

# 等待 ComfyUI 就绪
echo "→ 等待 ComfyUI 就绪 …"
for i in $(seq 1 60); do
  if curl -s http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    echo "✔ ComfyUI 就绪 (PID: $COMFYUI_PID)"
    break
  fi
  if [ "$i" = "60" ]; then
    echo "⚠️  ComfyUI 未在 60 秒内响应，后端仍将启动"
  fi
  sleep 1
done

# ---------- 7. 启动后端 ----------
echo "→ 启动后端 API (端口 8000) …"
(
  cd "$BACKEND_DIR"
  source .venv/bin/activate
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 \
    --reload \
    --reload-exclude ".venv" \
    --reload-exclude "*.db"
) &
BACKEND_PID=$!

echo ""
echo "========================================"
echo "  启动完成！"
echo ""
echo "  前端界面: http://127.0.0.1:8000"
echo "  API 文档: http://127.0.0.1:8000/docs"
echo "  ComfyUI:  http://127.0.0.1:8188"
echo ""
echo "  按 Ctrl+C 同时停止所有服务"
echo "========================================"
echo ""

# 等待子进程
wait
