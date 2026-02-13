#!/usr/bin/env bash
set -euo pipefail

# ============================================
#  游戏素材生成系统 — 一键部署脚本
#  自动下载 ComfyUI + AI 模型文件
# ============================================

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMFYUI_DIR="$ROOT_DIR/ComfyUI"
CKPT_DIR="$COMFYUI_DIR/models/checkpoints"
LORA_DIR="$COMFYUI_DIR/models/loras"
CONTROLNET_DIR="$COMFYUI_DIR/models/controlnet"
CUSTOM_NODES_DIR="$COMFYUI_DIR/custom_nodes"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 下载函数（支持断点续传）
download_file() {
    local url="$1"
    local output="$2"
    local filename=$(basename "$output")
    
    if [ -f "$output" ]; then
        echo -e "${GREEN}✔${NC} $filename 已存在，跳过下载"
        return 0
    fi
    
    echo -e "${BLUE}→${NC} 正在下载 $filename ..."
    echo -e "   来源: $url"
    echo -e "   目标: $output"
    echo ""
    
    # 创建目录
    mkdir -p "$(dirname "$output")"
    
    # 尝试使用 curl 或 wget 下载
    if command -v curl &>/dev/null; then
        if ! curl -L --progress-bar -C - "$url" -o "$output"; then
            echo -e "${RED}✗${NC} 下载失败: $filename"
            rm -f "$output"
            return 1
        fi
    elif command -v wget &>/dev/null; then
        if ! wget --show-progress --continue -O "$output" "$url"; then
            echo -e "${RED}✗${NC} 下载失败: $filename"
            rm -f "$output"
            return 1
        fi
    else
        echo -e "${RED}✗${NC} 错误: 找不到 curl 或 wget，请先安装其中之一"
        exit 1
    fi
    
    echo -e "${GREEN}✔${NC} 下载完成: $filename"
    return 0
}

# 检查磁盘空间
check_disk_space() {
    local required_gb=12
    local available_kb=$(df -k "$ROOT_DIR" | tail -1 | awk '{print $4}')
    local available_gb=$((available_kb / 1024 / 1024))
    
    if [ "$available_gb" -lt "$required_gb" ]; then
        echo -e "${RED}✗${NC} 磁盘空间不足！"
        echo "   需要: ${required_gb}GB+"
        echo "   可用: ${available_gb}GB"
        echo ""
        echo "模型文件较大，请确保有足够的磁盘空间。"
        exit 1
    fi
    
    echo -e "${GREEN}✔${NC} 磁盘空间检查通过 (可用: ${available_gb}GB)"
}

echo "========================================"
echo "  游戏素材生成系统 — 部署中 …"
echo "========================================"
echo ""

# ---------- 1. 检查依赖 ----------
echo -e "${BLUE}→${NC} 检查必要依赖 …"

if ! command -v git &>/dev/null; then
    echo -e "${RED}✗${NC} 错误: 找不到 git，请先安装 git"
    exit 1
fi

if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
    echo -e "${RED}✗${NC} 错误: 找不到 curl 或 wget，请先安装其中之一"
    exit 1
fi

echo -e "${GREEN}✔${NC} 依赖检查通过"
echo ""

# ---------- 2. 检查磁盘空间 ----------
check_disk_space
echo ""

# ---------- 3. 克隆 ComfyUI ----------
echo -e "${BLUE}→${NC} 检查 ComfyUI …"

if [ -d "$COMFYUI_DIR/.git" ]; then
    echo -e "${GREEN}✔${NC} ComfyUI 已存在，跳过克隆"
else
    echo -e "${BLUE}→${NC} 正在克隆 ComfyUI …"
    if [ -d "$COMFYUI_DIR" ]; then
        echo -e "${YELLOW}⚠${NC} 发现 ComfyUI 目录但非 git 仓库，将删除后重新克隆"
        rm -rf "$COMFYUI_DIR"
    fi
    git clone https://github.com/comfyanonymous/ComfyUI.git "$COMFYUI_DIR"
    echo -e "${GREEN}✔${NC} ComfyUI 克隆完成"
fi
echo ""

# ---------- 4. 创建模型目录 ----------
mkdir -p "$CKPT_DIR"
mkdir -p "$LORA_DIR"
mkdir -p "$CONTROLNET_DIR"

# ---------- 5. 下载模型文件 ----------
echo -e "${BLUE}→${NC} 检查模型文件 …"
echo ""
echo "注意: 模型文件较大，下载可能需要一些时间"
echo "      SDXL Base: ~6.9GB"
echo "      SDXL Lightning LoRA: ~300MB"
echo "      ControlNet Union ProMax: ~2.5GB"
echo ""

# SDXL Base 1.0
SDXL_URL="https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
SDXL_FILE="$CKPT_DIR/sd_xl_base_1.0.safetensors"

if ! download_file "$SDXL_URL" "$SDXL_FILE"; then
    echo ""
    echo -e "${YELLOW}⚠${NC} SDXL Base 下载失败"
    echo "   你可以稍后手动下载:"
    echo "   wget -O $SDXL_FILE '$SDXL_URL'"
fi
echo ""

# SDXL Lightning 4-step LoRA
LORA_URL="https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step_lora.safetensors"
LORA_FILE="$LORA_DIR/sdxl_lightning_4step_lora.safetensors"

if ! download_file "$LORA_URL" "$LORA_FILE"; then
    echo ""
    echo -e "${YELLOW}⚠${NC} SDXL Lightning LoRA 下载失败"
    echo "   你可以稍后手动下载:"
    echo "   wget -O $LORA_FILE '$LORA_URL'"
fi
echo ""

# ControlNet Union ProMax
CONTROLNET_URL="https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors"
CONTROLNET_FILE="$CONTROLNET_DIR/diffusion_pytorch_model_promax.safetensors"

if ! download_file "$CONTROLNET_URL" "$CONTROLNET_FILE"; then
    echo ""
    echo -e "${YELLOW}⚠${NC} ControlNet Union ProMax 下载失败"
    echo "   你可以稍后手动下载:"
    echo "   wget -O $CONTROLNET_FILE '$CONTROLNET_URL'"
fi
echo ""

# ---------- 6. 安装 ComfyUI 插件 ----------
echo -e "${BLUE}→${NC} 检查 ComfyUI 插件 …"
echo ""

# ComfyUI-layerdiffuse (透明通道)
LAYERDIFFUSE_DIR="$CUSTOM_NODES_DIR/ComfyUI-layerdiffuse"
if [ -d "$LAYERDIFFUSE_DIR/.git" ]; then
    echo -e "${GREEN}✔${NC} ComfyUI-layerdiffuse 已存在，跳过克隆"
else
    echo -e "${BLUE}→${NC} 正在克隆 ComfyUI-layerdiffuse …"
    git clone https://github.com/huchenlei/ComfyUI-layerdiffuse.git "$LAYERDIFFUSE_DIR"
    echo -e "${GREEN}✔${NC} ComfyUI-layerdiffuse 克隆完成"
fi

# 安装 layerdiffuse 依赖
if [ -f "$LAYERDIFFUSE_DIR/requirements.txt" ]; then
    echo -e "${BLUE}→${NC} 安装 layerdiffuse 依赖 …"
    pip3 install -r "$LAYERDIFFUSE_DIR/requirements.txt" --quiet
    echo -e "${GREEN}✔${NC} layerdiffuse 依赖安装完成"
fi
echo ""

# comfyui_controlnet_aux (预处理器)
CONTROLNET_AUX_DIR="$CUSTOM_NODES_DIR/comfyui_controlnet_aux"
if [ -d "$CONTROLNET_AUX_DIR/.git" ]; then
    echo -e "${GREEN}✔${NC} comfyui_controlnet_aux 已存在，跳过克隆"
else
    echo -e "${BLUE}→${NC} 正在克隆 comfyui_controlnet_aux …"
    git clone https://github.com/Fannovel16/comfyui_controlnet_aux.git "$CONTROLNET_AUX_DIR"
    echo -e "${GREEN}✔${NC} comfyui_controlnet_aux 克隆完成"
fi

# 安装 controlnet_aux 依赖
if [ -f "$CONTROLNET_AUX_DIR/requirements.txt" ]; then
    echo -e "${BLUE}→${NC} 安装 controlnet_aux 依赖 …"
    pip3 install -r "$CONTROLNET_AUX_DIR/requirements.txt" --quiet
    echo -e "${GREEN}✔${NC} controlnet_aux 依赖安装完成"
fi
echo ""

# ---------- 7. 部署完成 ----------
echo "========================================"
echo "  部署完成！"
echo ""

# 检查是否所有文件都准备好了
ALL_READY=true

if [ ! -d "$COMFYUI_DIR/.git" ]; then
    echo -e "${RED}✗${NC} ComfyUI 未正确克隆"
    ALL_READY=false
fi

if [ ! -f "$SDXL_FILE" ]; then
    echo -e "${RED}✗${NC} SDXL Base 模型未下载"
    echo "   手动下载: wget -O '$SDXL_FILE' '$SDXL_URL'"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} SDXL Base 模型就绪"
fi

if [ ! -f "$LORA_FILE" ]; then
    echo -e "${RED}✗${NC} SDXL Lightning LoRA 未下载"
    echo "   手动下载: wget -O '$LORA_FILE' '$LORA_URL'"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} SDXL Lightning LoRA 就绪"
fi

if [ ! -f "$CONTROLNET_FILE" ]; then
    echo -e "${RED}✗${NC} ControlNet Union ProMax 未下载"
    echo "   手动下载: wget -O '$CONTROLNET_FILE' '$CONTROLNET_URL'"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} ControlNet Union ProMax 就绪"
fi

if [ ! -d "$LAYERDIFFUSE_DIR/.git" ]; then
    echo -e "${RED}✗${NC} ComfyUI-layerdiffuse 插件未安装"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} ComfyUI-layerdiffuse 插件就绪"
fi

if [ ! -d "$CONTROLNET_AUX_DIR/.git" ]; then
    echo -e "${RED}✗${NC} comfyui_controlnet_aux 插件未安装"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} comfyui_controlnet_aux 插件就绪"
fi

echo ""

if [ "$ALL_READY" = true ]; then
    echo -e "${GREEN}所有文件已就绪！${NC}"
    echo ""
    echo "现在可以启动系统:"
    echo "  ./scripts/macos/start.sh"
    echo ""
    echo "启动后访问:"
    echo "  前端界面: http://127.0.0.1:8000"
    echo "  API 文档: http://127.0.0.1:8000/docs"
    echo "  ComfyUI:  http://127.0.0.1:8188"
else
    echo -e "${YELLOW}部分文件缺失，请根据上面的提示手动下载${NC}"
    exit 1
fi

echo "========================================"
