# ============================================
#  游戏素材生成系统 — 一键启动脚本 (Windows)
#  同时启动 ComfyUI (8188) + FastAPI 后端 (8000)
# ============================================

param(
    [switch]$NoComfyUI,
    [switch]$NoBackend
)

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$BACKEND_DIR = Join-Path $ROOT_DIR "backend"
$COMFYUI_DIR = Join-Path $ROOT_DIR "ComfyUI"
$BACKEND_VENV = Join-Path $BACKEND_DIR ".venv"
$COMFYUI_VENV = Join-Path $COMFYUI_DIR "venv"

# 全局变量用于跟踪进程
$script:ComfyUIProcess = $null
$script:BackendProcess = $null

# 清理函数
function Cleanup {
    Write-Host ""
    Write-Host "→ 正在关闭服务 …"
    
    if ($script:ComfyUIProcess -and !$script:ComfyUIProcess.HasExited) {
        Stop-Process -Id $script:ComfyUIProcess.Id -Force -ErrorAction SilentlyContinue
        Write-Host "  已停止 ComfyUI"
    }
    
    if ($script:BackendProcess -and !$script:BackendProcess.HasExited) {
        Stop-Process -Id $script:BackendProcess.Id -Force -ErrorAction SilentlyContinue
        Write-Host "  已停止后端"
    }
    
    Write-Host "✔ 已停止"
}

# 注册清理钩子
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Cleanup } | Out-Null

try {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  游戏素材生成系统 — 启动中 …" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    # ---------- 1. 检查 Python (>= 3.10) ----------
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
        Write-Host "❌ 找不到 Python 3.10+，请先安装" -ForegroundColor Red
        Write-Host "   当前系统 Python 版本过低，ComfyUI 要求 Python >= 3.10" -ForegroundColor Red
        Write-Host "   下载地址: https://www.python.org/downloads/" -ForegroundColor Yellow
        exit 1
    }

    $PY_VER = & $PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
    Write-Host "✔ 使用 Python: $PYTHON ($PY_VER)" -ForegroundColor Green

    # ---------- 辅助: 检查虚拟环境 Python 版本是否匹配 ----------
    function Check-VenvPython {
        param([string]$VenvDir, [string]$Label)
        if (Test-Path $VenvDir) {
            $venvPython = Join-Path $VenvDir "Scripts\python.exe"
            if (Test-Path $venvPython) {
                try {
                    $venvPyVer = & $venvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
                    if ($venvPyVer -ne $PY_VER) {
                        Write-Host "⚠️  $Label 虚拟环境 Python 版本不匹配 ($venvPyVer → $PY_VER)，重新创建 …" -ForegroundColor Yellow
                        Remove-Item -Recurse -Force $VenvDir
                    }
                } catch {
                    Write-Host "⚠️  $Label 虚拟环境损坏，重新创建 …" -ForegroundColor Yellow
                    Remove-Item -Recurse -Force $VenvDir
                }
            } else {
                Write-Host "⚠️  $Label 虚拟环境损坏，重新创建 …" -ForegroundColor Yellow
                Remove-Item -Recurse -Force $VenvDir
            }
        }
    }

    # ---------- 2. 后端虚拟环境 ----------
    Check-VenvPython -VenvDir $BACKEND_VENV -Label "后端"
    if (-not (Test-Path $BACKEND_VENV)) {
        Write-Host "→ 创建后端虚拟环境 …"
        & $PYTHON -m venv $BACKEND_VENV
    }
    
    Write-Host "→ 安装后端依赖 …"
    $activateScript = Join-Path $BACKEND_VENV "Scripts\Activate.ps1"
    & $activateScript
    & python -m pip install --quiet --upgrade pip
    & python -m pip install --quiet -r (Join-Path $BACKEND_DIR "requirements.txt")
    deactivate
    Write-Host "✔ 后端依赖就绪" -ForegroundColor Green

    # ---------- 3. 检查 ComfyUI ----------
    if (-not (Test-Path $COMFYUI_DIR)) {
        Write-Host "❌ ComfyUI 目录不存在: $COMFYUI_DIR" -ForegroundColor Red
        Write-Host "   请先运行: git clone https://github.com/comfyanonymous/ComfyUI.git" -ForegroundColor Red
        exit 1
    }

    Check-VenvPython -VenvDir $COMFYUI_VENV -Label "ComfyUI"
    if (-not (Test-Path $COMFYUI_VENV)) {
        Write-Host "→ 创建 ComfyUI 虚拟环境 …"
        & $PYTHON -m venv $COMFYUI_VENV
        $comfyActivate = Join-Path $COMFYUI_VENV "Scripts\Activate.ps1"
        & $comfyActivate
        & python -m pip install --quiet --upgrade pip
        & python -m pip install --quiet -r (Join-Path $COMFYUI_DIR "requirements.txt")
        deactivate
    }
    Write-Host "✔ ComfyUI 环境就绪" -ForegroundColor Green

    # ---------- 4. 检查模型 ----------
    $CKPT_DIR = Join-Path $COMFYUI_DIR "models\checkpoints"
    $LORA_DIR = Join-Path $COMFYUI_DIR "models\loras"

    if (-not (Test-Path (Join-Path $CKPT_DIR "sd_xl_base_1.0.safetensors"))) {
        Write-Host "⚠️  未找到 SDXL 基础模型，请下载到: $CKPT_DIR\sd_xl_base_1.0.safetensors" -ForegroundColor Yellow
    }
    if (-not (Test-Path (Join-Path $LORA_DIR "sdxl_lightning_4step_lora.safetensors"))) {
        Write-Host "⚠️  未找到 SDXL Lightning LoRA，请下载到: $LORA_DIR\sdxl_lightning_4step_lora.safetensors" -ForegroundColor Yellow
    }

    # ---------- 5. 创建 outputs 目录 ----------
    $outputsDir = Join-Path $ROOT_DIR "outputs"
    if (-not (Test-Path $outputsDir)) {
        New-Item -ItemType Directory -Path $outputsDir -Force | Out-Null
    }

    # ---------- 6. 启动 ComfyUI ----------
    if (-not $NoComfyUI) {
        Write-Host ""
        Write-Host "→ 启动 ComfyUI (端口 8188) …"
        
        $comfyActivate = Join-Path $COMFYUI_VENV "Scripts\Activate.ps1"
        $comfyCmd = @"
& "$comfyActivate"
cd "$COMFYUI_DIR"
python main.py --listen 0.0.0.0 --port 8188 --force-fp16
"@
        
        $script:ComfyUIProcess = Start-Process powershell -ArgumentList "-Command", $comfyCmd -PassThru -WindowStyle Normal
        
        # 等待 ComfyUI 就绪
        Write-Host "→ 等待 ComfyUI 就绪 …"
        $ready = $false
        for ($i = 1; $i -le 60; $i++) {
            try {
                $response = Invoke-WebRequest -Uri "http://127.0.0.1:8188/system_stats" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
                if ($response.StatusCode -eq 200) {
                    Write-Host "✔ ComfyUI 就绪 (PID: $($script:ComfyUIProcess.Id))" -ForegroundColor Green
                    $ready = $true
                    break
                }
            } catch {
                Start-Sleep -Seconds 1
            }
        }
        
        if (-not $ready) {
            Write-Host "⚠️  ComfyUI 未在 60 秒内响应，后端仍将启动" -ForegroundColor Yellow
        }
    }

    # ---------- 7. 启动后端 ----------
    if (-not $NoBackend) {
        Write-Host "→ 启动后端 API (端口 8000) …"
        
        $backendActivate = Join-Path $BACKEND_VENV "Scripts\Activate.ps1"
        $backendCmd = @"
& "$backendActivate"
cd "$BACKEND_DIR"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-exclude ".venv" --reload-exclude "*.db"
"@
        
        $script:BackendProcess = Start-Process powershell -ArgumentList "-Command", $backendCmd -PassThru -WindowStyle Normal
        
        # 等待后端启动
        Start-Sleep -Seconds 3
        
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  启动完成！" -ForegroundColor Green
        Write-Host ""
        Write-Host "  前端界面: http://127.0.0.1:8000"
        Write-Host "  API 文档: http://127.0.0.1:8000/docs"
        Write-Host "  ComfyUI:  http://127.0.0.1:8188"
        Write-Host ""
        Write-Host "  按 Ctrl+C 同时停止所有服务"
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
    }

    # 等待用户中断
    Write-Host "按 Ctrl+C 停止所有服务，或按 Enter 键退出并停止服务..."
    $null = [Console]::ReadKey($true)
    
} catch {
    Write-Host "❌ 错误: $_" -ForegroundColor Red
    Cleanup
    exit 1
} finally {
    Cleanup
}
