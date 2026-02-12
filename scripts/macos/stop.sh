#!/usr/bin/env bash
set -euo pipefail

# ============================================
#  游戏素材生成系统 — 一键停止脚本
#  停止 ComfyUI (8188) 与 FastAPI 后端 (8000)
# ============================================

echo "→ 正在停止服务 …"

pkill -f "uvicorn app.main" 2>/dev/null && echo "  已停止后端 (8000)" || true
pkill -f "python main.py.*8188" 2>/dev/null && echo "  已停止 ComfyUI (8188)" || true
pkill -f "ComfyUI.*main.py" 2>/dev/null || true

sleep 1

if lsof -i :8000 -i :8188 2>/dev/null | grep -q .; then
  echo "⚠️  仍有进程占用端口，尝试强制结束 …"
  for port in 8000 8188; do
    pid=$(lsof -t -i :$port 2>/dev/null) && kill -9 $pid 2>/dev/null && echo "  已强制结束端口 $port (PID $pid)" || true
  done
  sleep 1
fi

if ! lsof -i :8000 -i :8188 2>/dev/null | grep -q .; then
  echo "✔ 所有服务已停止，端口 8000 / 8188 已释放"
else
  echo "⚠️  请手动检查: lsof -i :8000 -i :8188"
  exit 1
fi
