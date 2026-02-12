# ============================================
#  游戏素材生成系统 — 一键停止脚本 (Windows)
#  停止 ComfyUI (8188) 与 FastAPI 后端 (8000)
# ============================================

Write-Host "→ 正在停止服务 …"

# 停止后端 (uvicorn)
$uvicornProcesses = Get-Process | Where-Object { $_.ProcessName -like "*python*" -and $_.CommandLine -like "*uvicorn*app.main*" } -ErrorAction SilentlyContinue
if ($uvicornProcesses) {
    foreach ($proc in $uvicornProcesses) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  已停止后端 (8000)"
}

# 停止 ComfyUI
$comfyProcesses = Get-Process | Where-Object { $_.ProcessName -like "*python*" -and ($_.CommandLine -like "*main.py*8188*" -or $_.CommandLine -like "*ComfyUI*main.py*") } -ErrorAction SilentlyContinue
if ($comfyProcesses) {
    foreach ($proc in $comfyProcesses) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  已停止 ComfyUI (8188)"
}

# 额外检查：通过端口查找进程
Start-Sleep -Seconds 1

function Get-ProcessByPort {
    param([int]$Port)
    
    try {
        $netstat = netstat -ano | Select-String ":$Port"
        if ($netstat) {
            foreach ($line in $netstat) {
                $parts = $line -split '\s+'
                $pid = $parts[-1]
                if ($pid -and $pid -match '^\d+$') {
                    return [int]$pid
                }
            }
        }
    } catch {
        return $null
    }
    return $null
}

$port8000 = Get-ProcessByPort -Port 8000
$port8188 = Get-ProcessByPort -Port 8188

if ($port8000 -or $port8188) {
    Write-Host "⚠️  仍有进程占用端口，尝试强制结束 …" -ForegroundColor Yellow
    
    if ($port8000) {
        try {
            Stop-Process -Id $port8000 -Force -ErrorAction SilentlyContinue
            Write-Host "  已强制结束端口 8000 (PID $port8000)"
        } catch {
            Write-Host "  无法结束端口 8000 进程" -ForegroundColor Red
        }
    }
    
    if ($port8188) {
        try {
            Stop-Process -Id $port8188 -Force -ErrorAction SilentlyContinue
            Write-Host "  已强制结束端口 8188 (PID $port8188)"
        } catch {
            Write-Host "  无法结束端口 8188 进程" -ForegroundColor Red
        }
    }
    
    Start-Sleep -Seconds 1
}

# 验证端口是否释放
$port8000Still = Get-ProcessByPort -Port 8000
$port8188Still = Get-ProcessByPort -Port 8188

if (-not $port8000Still -and -not $port8188Still) {
    Write-Host "✔ 所有服务已停止，端口 8000 / 8188 已释放" -ForegroundColor Green
} else {
    Write-Host "⚠️  请手动检查端口占用情况:" -ForegroundColor Yellow
    if ($port8000Still) { Write-Host "    端口 8000 仍被 PID $port8000Still 占用" -ForegroundColor Red }
    if ($port8188Still) { Write-Host "    端口 8188 仍被 PID $port8188Still 占用" -ForegroundColor Red }
    exit 1
}
