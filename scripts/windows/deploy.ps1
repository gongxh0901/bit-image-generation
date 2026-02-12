# ============================================
#  游戏素材生成系统 — 一键部署脚本 (Windows)
#  自动下载 ComfyUI + AI 模型文件
# ============================================

param(
    [switch]$SkipComfyUI,
    [switch]$SkipModels
)

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$COMFYUI_DIR = Join-Path $ROOT_DIR "ComfyUI"
$CKPT_DIR = Join-Path $COMFYUI_DIR "models\checkpoints"
$LORA_DIR = Join-Path $COMFYUI_DIR "models\loras"

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
    $requiredGB = 8
    $drive = Get-Item $ROOT_DIR | Select-Object -ExpandProperty PSDrive
    $availableGB = [math]::Floor($drive.Free / 1GB)
    
    if ($availableGB -lt $requiredGB) {
        Write-Error "磁盘空间不足！"
        Write-Host "   需要: ${requiredGB}GB+"
        Write-Host "   可用: ${availableGB}GB"
        Write-Host ""
        Write-Host "模型文件较大，请确保有足够的磁盘空间。"
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

# 检查 Python
$PYTHON = $null
$pythonCommands = @("python3.12", "python3.11", "python3", "python")
foreach ($cmd in $pythonCommands) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) {
        $PYTHON = $cmd
        break
    }
}

if (-not $PYTHON) {
    Write-Error "错误: 找不到 Python，请先安装 Python 3.10+"
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
if (-not (Test-Path $CKPT_DIR)) { New-Item -ItemType Directory -Path $CKPT_DIR -Force | Out-Null }
if (-not (Test-Path $LORA_DIR)) { New-Item -ItemType Directory -Path $LORA_DIR -Force | Out-Null }

# ---------- 5. 下载模型文件 ----------
if (-not $SkipModels) {
    Write-Info "检查模型文件 …"
    Write-Host ""
    Write-Host "注意: 模型文件较大，下载可能需要一些时间"
    Write-Host "      SDXL Base: ~6.9GB"
    Write-Host "      SDXL Lightning LoRA: ~300MB"
    Write-Host ""

    # SDXL Base 1.0
    $SDXL_URL = "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
    $SDXL_FILE = Join-Path $CKPT_DIR "sd_xl_base_1.0.safetensors"

    if (-not (Download-File -Url $SDXL_URL -Output $SDXL_FILE)) {
        Write-Host ""
        Write-Warning "SDXL Base 下载失败"
        Write-Host "   你可以稍后手动下载:"
        Write-Host "   Invoke-WebRequest -Uri '$SDXL_URL' -OutFile '$SDXL_FILE'"
    }
    Write-Host ""

    # SDXL Lightning 4-step LoRA
    $LORA_URL = "https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step_lora.safetensors"
    $LORA_FILE = Join-Path $LORA_DIR "sdxl_lightning_4step_lora.safetensors"

    if (-not (Download-File -Url $LORA_URL -Output $LORA_FILE)) {
        Write-Host ""
        Write-Warning "SDXL Lightning LoRA 下载失败"
        Write-Host "   你可以稍后手动下载:"
        Write-Host "   Invoke-WebRequest -Uri '$LORA_URL' -OutFile '$LORA_FILE'"
    }
    Write-Host ""
}

# ---------- 6. 部署完成 ----------
Write-Host "========================================" -ForegroundColor Green
Write-Host "  部署完成！" -ForegroundColor Green
Write-Host ""

# 检查是否所有文件都准备好了
$ALL_READY = $true

if (-not (Test-Path (Join-Path $COMFYUI_DIR ".git"))) {
    Write-Error "ComfyUI 未正确克隆"
    $ALL_READY = $false
}

$SDXL_FILE = Join-Path $CKPT_DIR "sd_xl_base_1.0.safetensors"
$LORA_FILE = Join-Path $LORA_DIR "sdxl_lightning_4step_lora.safetensors"

if (-not (Test-Path $SDXL_FILE)) {
    Write-Error "SDXL Base 模型未下载"
    Write-Host "   手动下载: Invoke-WebRequest -Uri '$SDXL_URL' -OutFile '$SDXL_FILE'"
    $ALL_READY = $false
} else {
    Write-Success "SDXL Base 模型就绪"
}

if (-not (Test-Path $LORA_FILE)) {
    Write-Error "SDXL Lightning LoRA 未下载"
    Write-Host "   手动下载: Invoke-WebRequest -Uri '$LORA_URL' -OutFile '$LORA_FILE'"
    $ALL_READY = $false
} else {
    Write-Success "SDXL Lightning LoRA 就绪"
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
    exit 1
}

Write-Host "========================================" -ForegroundColor Green
