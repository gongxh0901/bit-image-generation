# ============================================
#  游戏素材生成系统 — 一键部署脚本 (Windows)
#  自动下载 ComfyUI + Flux.1 Schnell 模型 + 插件
# ============================================

param(
    [switch]$SkipComfyUI,
    [switch]$SkipModels
)

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$COMFYUI_DIR = Join-Path $ROOT_DIR "ComfyUI"
$UNET_DIR = Join-Path $COMFYUI_DIR "models\unet"
$CLIP_DIR = Join-Path $COMFYUI_DIR "models\clip"
$VAE_DIR = Join-Path $COMFYUI_DIR "models\vae"
$CONTROLNET_DIR = Join-Path $COMFYUI_DIR "models\controlnet"
$CUSTOM_NODES_DIR = Join-Path $COMFYUI_DIR "custom_nodes"

# 颜色函数
function Write-Success { param([string]$Message) Write-Host "✔ $Message" -ForegroundColor Green }
function Write-Info { param([string]$Message) Write-Host "→ $Message" -ForegroundColor Cyan }
function Write-Warning { param([string]$Message) Write-Host "⚠ $Message" -ForegroundColor Yellow }
function Write-Error { param([string]$Message) Write-Host "✗ $Message" -ForegroundColor Red }

# 下载函数（支持断点续传）
function Download-File {
    param(
        [string]$Url,
        [string]$Output
    )
    
    $filename = Split-Path $Output -Leaf
    
    if (Test-Path $Output) {
        Write-Success "$filename 已存在，跳过下载"
        return $true
    }
    
    Write-Info "正在下载 $filename ..."
    Write-Host "   来源: $Url"
    Write-Host "   目标: $Output"
    Write-Host ""
    
    # 创建目录
    $outputDir = Split-Path $Output -Parent
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }
    
    try {
        # 使用 BITS 传输（Windows 原生）
        $bitsJob = Start-BitsTransfer -Source $Url -Destination $Output -DisplayName "Downloading $filename" -Description "从 HuggingFace 下载模型文件" -ErrorAction Stop
        
        Write-Success "下载完成: $filename"
        return $true
    } catch {
        # BITS 失败，尝试使用 Invoke-WebRequest
        try {
            Write-Warning "BITS 传输失败，尝试使用 HTTP 下载..."
            Invoke-WebRequest -Uri $Url -OutFile $Output -UseBasicParsing -ErrorAction Stop
            Write-Success "下载完成: $filename"
            return $true
        } catch {
            Write-Error "下载失败: $filename"
            Write-Host "   错误: $_"
            if (Test-Path $Output) {
                Remove-Item $Output -Force
            }
            return $false
        }
    }
}

# 检查磁盘空间
function Check-DiskSpace {
    $requiredGB = 15
    $drive = Get-Item $ROOT_DIR | Select-Object -ExpandProperty PSDrive
    $availableGB = [math]::Floor($drive.Free / 1GB)
    
    if ($availableGB -lt $requiredGB) {
        Write-Error "磁盘空间不足！"
        Write-Host "   需要: ${requiredGB}GB+"
        Write-Host "   可用: ${availableGB}GB"
        Write-Host ""
        Write-Host "Flux 模型文件较大，请确保有足够的磁盘空间。"
        exit 1
    }
    
    Write-Success "磁盘空间检查通过 (可用: ${availableGB}GB)"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  游戏素材生成系统 — 部署中 …" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. 检查依赖 ----------
Write-Info "检查必要依赖 …"

# 检查 git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "错误: 找不到 git，请先安装 git"
    Write-Host "   下载地址: https://git-scm.com/download/win"
    exit 1
}

# 检查 Python (>= 3.10)
$PYTHON = $null
$pythonCommands = @("python3.12", "python3.11", "python3.10", "python3", "python")
foreach ($cmd in $pythonCommands) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) {
        $pyMinor = & $cmd -c "import sys; print(sys.version_info.minor)"
        $pyMajor = & $cmd -c "import sys; print(sys.version_info.major)"
        if ([int]$pyMajor -eq 3 -and [int]$pyMinor -ge 10) {
            $PYTHON = $cmd
            break
        }
    }
}

if (-not $PYTHON) {
    Write-Error "错误: 找不到 Python 3.10+，当前系统 Python 版本过低"
    Write-Host "   ComfyUI 要求 Python >= 3.10"
    Write-Host "   下载地址: https://www.python.org/downloads/"
    exit 1
}

Write-Success "依赖检查通过"
Write-Host ""

# ---------- 2. 检查磁盘空间 ----------
Check-DiskSpace
Write-Host ""

# ---------- 3. 克隆 ComfyUI ----------
if (-not $SkipComfyUI) {
    Write-Info "检查 ComfyUI …"
    
    if (Test-Path (Join-Path $COMFYUI_DIR ".git")) {
        Write-Success "ComfyUI 已存在，跳过克隆"
    } else {
        if (Test-Path $COMFYUI_DIR) {
            Write-Warning "发现 ComfyUI 目录但非 git 仓库，将删除后重新克隆"
            Remove-Item -Recurse -Force $COMFYUI_DIR
        }
        
        Write-Info "正在克隆 ComfyUI …"
        try {
            git clone https://github.com/comfyanonymous/ComfyUI.git $COMFYUI_DIR
            Write-Success "ComfyUI 克隆完成"
        } catch {
            Write-Error "ComfyUI 克隆失败"
            Write-Host "   错误: $_"
            exit 1
        }
    }
    Write-Host ""
}

# ---------- 4. 创建模型目录 ----------
if (-not (Test-Path $UNET_DIR)) { New-Item -ItemType Directory -Path $UNET_DIR -Force | Out-Null }
if (-not (Test-Path $CLIP_DIR)) { New-Item -ItemType Directory -Path $CLIP_DIR -Force | Out-Null }
if (-not (Test-Path $VAE_DIR)) { New-Item -ItemType Directory -Path $VAE_DIR -Force | Out-Null }
if (-not (Test-Path $CONTROLNET_DIR)) { New-Item -ItemType Directory -Path $CONTROLNET_DIR -Force | Out-Null }

# ---------- 5. 下载模型文件 ----------
if (-not $SkipModels) {
    Write-Info "检查模型文件 …"
    Write-Host ""
    Write-Host "注意: 模型文件较大，下载可能需要一些时间"
    Write-Host "      Flux.1 Schnell GGUF: ~7.5GB"
    Write-Host "      CLIP-L: ~250MB"
    Write-Host "      T5-XXL: ~9.5GB"
    Write-Host "      Flux VAE: ~350MB"
    Write-Host "      ControlNet Union (可选): ~3GB"
    Write-Host ""

    # Flux.1 Schnell GGUF Q5_K_S
    $FLUX_UNET_URL = "https://huggingface.co/city96/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-Q5_K_S.gguf"
    $FLUX_UNET_FILE = Join-Path $UNET_DIR "flux1-schnell-Q5_K_S.gguf"

    if (-not (Download-File -Url $FLUX_UNET_URL -Output $FLUX_UNET_FILE)) {
        Write-Host ""
        Write-Warning "Flux.1 Schnell GGUF 下载失败"
        Write-Host "   你可以稍后手动下载:"
        Write-Host "   Invoke-WebRequest -Uri '$FLUX_UNET_URL' -OutFile '$FLUX_UNET_FILE'"
    }
    Write-Host ""

    # CLIP-L
    $CLIP_L_URL = "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
    $CLIP_L_FILE = Join-Path $CLIP_DIR "clip_l.safetensors"

    if (-not (Download-File -Url $CLIP_L_URL -Output $CLIP_L_FILE)) {
        Write-Host ""
        Write-Warning "CLIP-L 编码器下载失败"
        Write-Host "   你可以稍后手动下载:"
        Write-Host "   Invoke-WebRequest -Uri '$CLIP_L_URL' -OutFile '$CLIP_L_FILE'"
    }
    Write-Host ""

    # T5-XXL
    $T5XXL_URL = "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors"
    $T5XXL_FILE = Join-Path $CLIP_DIR "t5xxl_fp16.safetensors"

    if (-not (Download-File -Url $T5XXL_URL -Output $T5XXL_FILE)) {
        Write-Host ""
        Write-Warning "T5-XXL 编码器下载失败"
        Write-Host "   你可以稍后手动下载:"
        Write-Host "   Invoke-WebRequest -Uri '$T5XXL_URL' -OutFile '$T5XXL_FILE'"
    }
    Write-Host ""

    # Flux VAE
    $FLUX_VAE_URL = "https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors"
    $FLUX_VAE_FILE = Join-Path $VAE_DIR "ae.safetensors"

    if (-not (Download-File -Url $FLUX_VAE_URL -Output $FLUX_VAE_FILE)) {
        Write-Host ""
        Write-Warning "Flux VAE 下载失败"
        Write-Host "   你可以稍后手动下载:"
        Write-Host "   Invoke-WebRequest -Uri '$FLUX_VAE_URL' -OutFile '$FLUX_VAE_FILE'"
    }
    Write-Host ""

    # ControlNet Union (可选)
    Write-Info "ControlNet Union 为可选模型，是否下载？(约 3GB)"
    $downloadCN = Read-Host "下载 ControlNet Union? [y/N]"
    if ($downloadCN -match "^[Yy]$") {
        $CONTROLNET_URL = "https://huggingface.co/InstantX/FLUX.1-dev-Controlnet-Union/resolve/main/diffusion_pytorch_model.safetensors"
        $CONTROLNET_FILE = Join-Path $CONTROLNET_DIR "instantx-flux-union-controlnet.safetensors"
        
        if (-not (Download-File -Url $CONTROLNET_URL -Output $CONTROLNET_FILE)) {
            Write-Host ""
            Write-Warning "ControlNet Union 下载失败"
            Write-Host "   你可以稍后手动下载:"
            Write-Host "   Invoke-WebRequest -Uri '$CONTROLNET_URL' -OutFile '$CONTROLNET_FILE'"
        }
    } else {
        Write-Info "跳过 ControlNet Union 下载"
    }
    Write-Host ""
}

# ---------- 6. 安装 ComfyUI 插件 ----------
Write-Info "检查 ComfyUI 插件 …"
Write-Host ""

# ComfyUI-GGUF (必需)
$GGUF_DIR = Join-Path $CUSTOM_NODES_DIR "ComfyUI-GGUF"
if (Test-Path (Join-Path $GGUF_DIR ".git")) {
    Write-Success "ComfyUI-GGUF 已存在，跳过克隆"
} else {
    Write-Info "正在克隆 ComfyUI-GGUF …"
    try {
        git clone https://github.com/city96/ComfyUI-GGUF.git $GGUF_DIR
        Write-Success "ComfyUI-GGUF 克隆完成"
    } catch {
        Write-Warning "ComfyUI-GGUF 克隆失败: $_"
    }
}

# 安装 GGUF 依赖
$GGUF_REQ = Join-Path $GGUF_DIR "requirements.txt"
if (Test-Path $GGUF_REQ) {
    Write-Info "安装 ComfyUI-GGUF 依赖 …"
    & pip install -r $GGUF_REQ --quiet
    Write-Success "ComfyUI-GGUF 依赖安装完成"
}
Write-Host ""

# ComfyUI-RMBG (BiRefNet 抠图，必需)
$RMBG_DIR = Join-Path $CUSTOM_NODES_DIR "ComfyUI-RMBG"
if (Test-Path (Join-Path $RMBG_DIR ".git")) {
    Write-Success "ComfyUI-RMBG 已存在，跳过克隆"
} else {
    Write-Info "正在克隆 ComfyUI-RMBG …"
    try {
        git clone https://github.com/1038lab/ComfyUI-RMBG.git $RMBG_DIR
        Write-Success "ComfyUI-RMBG 克隆完成"
    } catch {
        Write-Warning "ComfyUI-RMBG 克隆失败: $_"
    }
}

# 安装 RMBG 依赖
$RMBG_REQ = Join-Path $RMBG_DIR "requirements.txt"
if (Test-Path $RMBG_REQ) {
    Write-Info "安装 ComfyUI-RMBG 依赖 …"
    & pip install -r $RMBG_REQ --quiet
    Write-Success "ComfyUI-RMBG 依赖安装完成"
}
Write-Host ""

# comfyui_controlnet_aux (ControlNet 预处理器，可选)
$CONTROLNET_AUX_DIR = Join-Path $CUSTOM_NODES_DIR "comfyui_controlnet_aux"
if (Test-Path (Join-Path $CONTROLNET_AUX_DIR ".git")) {
    Write-Success "comfyui_controlnet_aux 已存在，跳过克隆"
} else {
    Write-Info "正在克隆 comfyui_controlnet_aux …"
    try {
        git clone https://github.com/Fannovel16/comfyui_controlnet_aux.git $CONTROLNET_AUX_DIR
        Write-Success "comfyui_controlnet_aux 克隆完成"
    } catch {
        Write-Warning "comfyui_controlnet_aux 克隆失败: $_"
    }
}

# 安装 controlnet_aux 依赖
$CONTROLNET_AUX_REQ = Join-Path $CONTROLNET_AUX_DIR "requirements.txt"
if (Test-Path $CONTROLNET_AUX_REQ) {
    Write-Info "安装 controlnet_aux 依赖 …"
    & pip install -r $CONTROLNET_AUX_REQ --quiet
    Write-Success "controlnet_aux 依赖安装完成"
}
Write-Host ""

# ---------- 7. 部署完成 ----------
Write-Host "========================================" -ForegroundColor Green
Write-Host "  部署完成！" -ForegroundColor Green
Write-Host ""

# 检查是否所有文件都准备好了
$ALL_READY = $true

if (-not (Test-Path (Join-Path $COMFYUI_DIR ".git"))) {
    Write-Error "ComfyUI 未正确克隆"
    $ALL_READY = $false
}

$FLUX_UNET_FILE = Join-Path $UNET_DIR "flux1-schnell-Q5_K_S.gguf"
$CLIP_L_FILE = Join-Path $CLIP_DIR "clip_l.safetensors"
$T5XXL_FILE = Join-Path $CLIP_DIR "t5xxl_fp16.safetensors"
$FLUX_VAE_FILE = Join-Path $VAE_DIR "ae.safetensors"

if (-not (Test-Path $FLUX_UNET_FILE)) {
    Write-Error "Flux.1 Schnell GGUF 模型未下载"
    $FLUX_UNET_URL = "https://huggingface.co/city96/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-Q5_K_S.gguf"
    Write-Host "   手动下载: Invoke-WebRequest -Uri '$FLUX_UNET_URL' -OutFile '$FLUX_UNET_FILE'"
    $ALL_READY = $false
} else {
    Write-Success "Flux.1 Schnell GGUF 模型就绪"
}

if (-not (Test-Path $CLIP_L_FILE)) {
    Write-Error "CLIP-L 编码器未下载"
    $CLIP_L_URL = "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors"
    Write-Host "   手动下载: Invoke-WebRequest -Uri '$CLIP_L_URL' -OutFile '$CLIP_L_FILE'"
    $ALL_READY = $false
} else {
    Write-Success "CLIP-L 编码器就绪"
}

if (-not (Test-Path $T5XXL_FILE)) {
    Write-Error "T5-XXL 编码器未下载"
    $T5XXL_URL = "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors"
    Write-Host "   手动下载: Invoke-WebRequest -Uri '$T5XXL_URL' -OutFile '$T5XXL_FILE'"
    $ALL_READY = $false
} else {
    Write-Success "T5-XXL 编码器就绪"
}

if (-not (Test-Path $FLUX_VAE_FILE)) {
    Write-Error "Flux VAE 未下载"
    $FLUX_VAE_URL = "https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors"
    Write-Host "   手动下载: Invoke-WebRequest -Uri '$FLUX_VAE_URL' -OutFile '$FLUX_VAE_FILE'"
    $ALL_READY = $false
} else {
    Write-Success "Flux VAE 就绪"
}

$GGUF_DIR = Join-Path $CUSTOM_NODES_DIR "ComfyUI-GGUF"
if (-not (Test-Path (Join-Path $GGUF_DIR ".git"))) {
    Write-Error "ComfyUI-GGUF 插件未安装"
    $ALL_READY = $false
} else {
    Write-Success "ComfyUI-GGUF 插件就绪"
}

$RMBG_DIR = Join-Path $CUSTOM_NODES_DIR "ComfyUI-RMBG"
if (-not (Test-Path (Join-Path $RMBG_DIR ".git"))) {
    Write-Error "ComfyUI-RMBG 插件未安装"
    $ALL_READY = $false
} else {
    Write-Success "ComfyUI-RMBG 插件就绪"
}

$CONTROLNET_AUX_DIR = Join-Path $CUSTOM_NODES_DIR "comfyui_controlnet_aux"
if (-not (Test-Path (Join-Path $CONTROLNET_AUX_DIR ".git"))) {
    Write-Error "comfyui_controlnet_aux 插件未安装"
    $ALL_READY = $false
} else {
    Write-Success "comfyui_controlnet_aux 插件就绪"
}

Write-Host ""

if ($ALL_READY) {
    Write-Host "所有文件已就绪！" -ForegroundColor Green
    Write-Host ""
    Write-Host "现在可以启动系统:"
    Write-Host "  .\scripts\windows\start.ps1" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "启动后访问:"
    Write-Host "  前端界面: http://127.0.0.1:8000"
    Write-Host "  API 文档: http://127.0.0.1:8000/docs"
    Write-Host "  ComfyUI:  http://127.0.0.1:8188"
} else {
    Write-Warning "部分文件缺失，请根据上面的提示手动下载"
    Write-Host ""
    Write-Host "或使用 HuggingFace CLI 快速下载:"
    Write-Host "  pip install huggingface-hub[cli]"
    Write-Host "  huggingface-cli download city96/FLUX.1-schnell-gguf flux1-schnell-Q5_K_S.gguf --local-dir $UNET_DIR --local-dir-use-symlinks False"
    Write-Host "  huggingface-cli download comfyanonymous/flux_text_encoders clip_l.safetensors t5xxl_fp16.safetensors --local-dir $CLIP_DIR --local-dir-use-symlinks False"
    Write-Host "  huggingface-cli download black-forest-labs/FLUX.1-schnell ae.safetensors --local-dir $VAE_DIR --local-dir-use-symlinks False"
    exit 1
}

Write-Host "========================================" -ForegroundColor Green
