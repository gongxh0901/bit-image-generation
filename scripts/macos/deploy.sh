#!/usr/bin/env bash
set -euo pipefail

# ============================================
#  游戏素材生成系统 — 一键部署脚本
#  自动下载 ComfyUI + Flux.1 Schnell 模型 + 插件
# ============================================

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMFYUI_DIR="$ROOT_DIR/ComfyUI"
UNET_DIR="$COMFYUI_DIR/models/unet"
CLIP_DIR="$COMFYUI_DIR/models/clip"
VAE_DIR="$COMFYUI_DIR/models/vae"
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
    local required_gb=15
    local available_kb=$(df -k "$ROOT_DIR" | tail -1 | awk '{print $4}')
    local available_gb=$((available_kb / 1024 / 1024))
    
    if [ "$available_gb" -lt "$required_gb" ]; then
        echo -e "${RED}✗${NC} 磁盘空间不足！"
        echo "   需要: ${required_gb}GB+"
        echo "   可用: ${available_gb}GB"
        echo ""
        echo "Flux 模型文件较大，请确保有足够的磁盘空间。"
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
mkdir -p "$UNET_DIR"
mkdir -p "$CLIP_DIR"
mkdir -p "$VAE_DIR"
mkdir -p "$CONTROLNET_DIR"

# ---------- 5. 下载模型文件 ----------
echo -e "${BLUE}→${NC} 检查模型文件 …"
echo ""
echo "注意: 模型文件较大，下载可能需要一些时间"
echo "      Flux.1 Schnell GGUF: ~7.5GB"
echo "      CLIP-L: ~250MB"
echo "      T5-XXL: ~9.5GB"
echo "      Flux VAE: ~350MB"
echo "      ControlNet Union (可选): ~3GB"
echo ""

# Flux.1 Schnell GGUF Q5_K_S
FLUX_UNET_URL="https://huggingface.co/city96/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-Q5_K_S.gguf"
FLUX_UNET_FILE="$UNET_DIR/flux1-schnell-Q5_K_S.gguf"

if ! download_file "$FLUX_UNET_URL" "$FLUX_UNET_FILE"; then
    echo ""
    echo -e "${YELLOW}⚠${NC} Flux.1 Schnell GGUF 下载失败"
    echo "   你可以稍后手动下载:"
    echo "   wget -O $FLUX_UNET_FILE '$FLUX_UNET_URL'"
fi
echo ""

# CLIP-L
CLIP_L_URL="https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
CLIP_L_FILE="$CLIP_DIR/clip_l.safetensors"

if ! download_file "$CLIP_L_URL" "$CLIP_L_FILE"; then
    echo ""
    echo -e "${YELLOW}⚠${NC} CLIP-L 编码器下载失败"
    echo "   你可以稍后手动下载:"
    echo "   wget -O $CLIP_L_FILE '$CLIP_L_URL'"
fi
echo ""

# T5-XXL
T5XXL_URL="https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors"
T5XXL_FILE="$CLIP_DIR/t5xxl_fp16.safetensors"

if ! download_file "$T5XXL_URL" "$T5XXL_FILE"; then
    echo ""
    echo -e "${YELLOW}⚠${NC} T5-XXL 编码器下载失败"
    echo "   你可以稍后手动下载:"
    echo "   wget -O $T5XXL_FILE '$T5XXL_URL'"
fi
echo ""

# Flux VAE
FLUX_VAE_URL="https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors"
FLUX_VAE_FILE="$VAE_DIR/ae.safetensors"

if ! download_file "$FLUX_VAE_URL" "$FLUX_VAE_FILE"; then
    echo ""
    echo -e "${YELLOW}⚠${NC} Flux VAE 下载失败"
    echo "   你可以稍后手动下载:"
    echo "   wget -O $FLUX_VAE_FILE '$FLUX_VAE_URL'"
fi
echo ""

# ControlNet Union (可选)
echo -e "${BLUE}→${NC} ControlNet Union 为可选模型，是否下载？(约 3GB)"
read -p "下载 ControlNet Union? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    CONTROLNET_URL="https://huggingface.co/InstantX/FLUX.1-dev-Controlnet-Union/resolve/main/diffusion_pytorch_model.safetensors"
    CONTROLNET_FILE="$CONTROLNET_DIR/instantx-flux-union-controlnet.safetensors"
    
    if ! download_file "$CONTROLNET_URL" "$CONTROLNET_FILE"; then
        echo ""
        echo -e "${YELLOW}⚠${NC} ControlNet Union 下载失败"
        echo "   你可以稍后手动下载:"
        echo "   wget -O $CONTROLNET_FILE '$CONTROLNET_URL'"
    fi
else
    echo -e "${BLUE}→${NC} 跳过 ControlNet Union 下载"
fi
echo ""

# ---------- 6. 安装 ComfyUI 插件 ----------
echo -e "${BLUE}→${NC} 检查 ComfyUI 插件 …"
echo ""

# ComfyUI-GGUF (必需)
GGUF_DIR="$CUSTOM_NODES_DIR/ComfyUI-GGUF"
if [ -d "$GGUF_DIR/.git" ]; then
    echo -e "${GREEN}✔${NC} ComfyUI-GGUF 已存在，跳过克隆"
else
    echo -e "${BLUE}→${NC} 正在克隆 ComfyUI-GGUF …"
    git clone https://github.com/city96/ComfyUI-GGUF.git "$GGUF_DIR"
    echo -e "${GREEN}✔${NC} ComfyUI-GGUF 克隆完成"
fi

# 安装 GGUF 依赖
if [ -f "$GGUF_DIR/requirements.txt" ]; then
    echo -e "${BLUE}→${NC} 安装 ComfyUI-GGUF 依赖 …"
    pip3 install -r "$GGUF_DIR/requirements.txt" --quiet
    echo -e "${GREEN}✔${NC} ComfyUI-GGUF 依赖安装完成"
fi
echo ""

# ComfyUI-RMBG (BiRefNet 抠图，必需)
RMBG_DIR="$CUSTOM_NODES_DIR/ComfyUI-RMBG"
if [ -d "$RMBG_DIR/.git" ]; then
    echo -e "${GREEN}✔${NC} ComfyUI-RMBG 已存在，跳过克隆"
else
    echo -e "${BLUE}→${NC} 正在克隆 ComfyUI-RMBG …"
    git clone https://github.com/1038lab/ComfyUI-RMBG.git "$RMBG_DIR"
    echo -e "${GREEN}✔${NC} ComfyUI-RMBG 克隆完成"
fi

# 安装 RMBG 依赖
if [ -f "$RMBG_DIR/requirements.txt" ]; then
    echo -e "${BLUE}→${NC} 安装 ComfyUI-RMBG 依赖 …"
    pip3 install -r "$RMBG_DIR/requirements.txt" --quiet
    echo -e "${GREEN}✔${NC} ComfyUI-RMBG 依赖安装完成"
fi
echo ""

# comfyui_controlnet_aux (ControlNet 预处理器，可选)
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

if [ ! -f "$FLUX_UNET_FILE" ]; then
    echo -e "${RED}✗${NC} Flux.1 Schnell GGUF 模型未下载"
    echo "   手动下载: curl -L -o '$FLUX_UNET_FILE' '$FLUX_UNET_URL'"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} Flux.1 Schnell GGUF 模型就绪"
fi

if [ ! -f "$CLIP_L_FILE" ]; then
    echo -e "${RED}✗${NC} CLIP-L 编码器未下载"
    echo "   手动下载: curl -L -o '$CLIP_L_FILE' '$CLIP_L_URL'"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} CLIP-L 编码器就绪"
fi

if [ ! -f "$T5XXL_FILE" ]; then
    echo -e "${RED}✗${NC} T5-XXL 编码器未下载"
    echo "   手动下载: curl -L -o '$T5XXL_FILE' '$T5XXL_URL'"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} T5-XXL 编码器就绪"
fi

if [ ! -f "$FLUX_VAE_FILE" ]; then
    echo -e "${RED}✗${NC} Flux VAE 未下载"
    echo "   手动下载: curl -L -o '$FLUX_VAE_FILE' '$FLUX_VAE_URL'"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} Flux VAE 就绪"
fi

if [ ! -d "$GGUF_DIR/.git" ]; then
    echo -e "${RED}✗${NC} ComfyUI-GGUF 插件未安装"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} ComfyUI-GGUF 插件就绪"
fi

if [ ! -d "$RMBG_DIR/.git" ]; then
    echo -e "${RED}✗${NC} ComfyUI-RMBG 插件未安装"
    ALL_READY=false
else
    echo -e "${GREEN}✔${NC} ComfyUI-RMBG 插件就绪"
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
    echo ""
    echo "或使用 HuggingFace CLI 快速下载:"
    echo "  pip install huggingface-hub[cli]"
    echo "  huggingface-cli download city96/FLUX.1-schnell-gguf flux1-schnell-Q5_K_S.gguf --local-dir $UNET_DIR --local-dir-use-symlinks False"
    echo "  huggingface-cli download comfyanonymous/flux_text_encoders clip_l.safetensors t5xxl_fp16.safetensors --local-dir $CLIP_DIR --local-dir-use-symlinks False"
    echo "  huggingface-cli download black-forest-labs/FLUX.1-schnell ae.safetensors --local-dir $VAE_DIR --local-dir-use-symlinks False"
    exit 1
fi

echo "========================================"
