# start-dsh.ps1 — 启动 DeepSeek Harness Web GUI
# 用法：
#   PowerShell 里：  .\start-dsh.ps1
#   或双击 start-dsh.cmd

$ErrorActionPreference = 'Stop'

# DSH 源码目录（按需修改，或设环境变量 DSH_HARNESS 覆盖）
$Harness = if ($env:DSH_HARNESS) { $env:DSH_HARNESS } else { 'F:\deepseek-harness' }

if (-not (Test-Path (Join-Path $Harness 'package.json'))) {
    Write-Error "未找到 DSH 目录：$Harness —— 请修改本脚本顶部的 `$Harness 路径"
    exit 1
}

Write-Host ''
Write-Host 'DeepSeek Harness 启动中 ...' -ForegroundColor Cyan
Write-Host "  目录 : $Harness" -ForegroundColor DarkGray
Write-Host '  地址 : http://127.0.0.1:3080' -ForegroundColor DarkGray
Write-Host ''
Write-Host '提示：动态插件（attach-files / chime）需在对话里说「加载所有插件」加载。' -ForegroundColor Yellow
Write-Host '（后续可改用 dsh plugin 机制做到开机自启，见 LOAD.md）' -ForegroundColor Yellow
Write-Host ''

Set-Location $Harness
pnpm dsh web
