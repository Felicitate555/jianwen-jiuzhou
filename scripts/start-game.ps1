$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$gameUrl = 'http://127.0.0.1:5173/'
$proxyUrl = 'http://127.0.0.1:8787'
$frontendProcess = $null
$proxyProcess = $null
$ownsMutex = $false
$launchMutex = $null

function Get-ProxyHealth {
    try {
        $health = Invoke-RestMethod -Uri ($proxyUrl + '/health') -TimeoutSec 2
        if ($health.status -eq 'ok' -and $health.service -eq 'jianwen-life-director') { return $health }
    } catch {}
    return $null
}

function Test-ThisGame {
    try {
        $identity = Invoke-RestMethod -Uri ($gameUrl + '__jianwen_launcher') -TimeoutSec 2
        return ($identity.app -eq 'jian-wen-jiuzhou' -and
            [string]::Equals($identity.root, $projectRoot, [StringComparison]::OrdinalIgnoreCase))
    } catch { return $false }
}

function Test-PortOccupied([int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if ($attempt.AsyncWaitHandle.WaitOne(500)) {
            $client.EndConnect($attempt)
            return $true
        }
        return $false
    } catch { return $false } finally { $client.Dispose() }
}

function Open-Game {
    Write-Host "游戏地址：$gameUrl" -ForegroundColor Green
    try { Start-Process -FilePath $gameUrl }
    catch { Write-Host '未能自动打开浏览器，请手动访问上面的地址。' -ForegroundColor Yellow }
}

function Wait-ForService([scriptblock]$probe, [System.Diagnostics.Process]$process, [int]$seconds, [string]$failure) {
    $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process) {
            $process.Refresh()
            if ($process.HasExited) { throw $failure }
        }
        $result = & $probe
        if ($result) { return $result }
        Start-Sleep -Milliseconds 250
    }
    throw $failure
}

try {
    Set-Location -LiteralPath $projectRoot
    Write-Host '正在启动《剑问九州》……' -ForegroundColor Cyan
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        throw '未检测到 Node.js，请先安装 Node.js 后重新启动《剑问九州》。下载地址：https://nodejs.org/'
    }
    if (-not $npmCommand) {
        throw '已检测到 Node.js，但 npm 不可用。请重新安装包含 npm 的 Node.js LTS 后再启动《剑问九州》。'
    }

    $launchMutex = New-Object System.Threading.Mutex($false, 'Local\JianWenJiuZhou-Launcher')
    Write-Host '正在检查本地前端与 AI Proxy……'
    try { $ownsMutex = $launchMutex.WaitOne(120000) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw '另一个启动窗口仍在准备游戏，请稍后重试。' }

    $frontendReady = Test-ThisGame
    $proxyHealth = Get-ProxyHealth
    if (-not $frontendReady -and (Test-PortOccupied 5173)) {
        throw '端口 5173 已被其他程序占用，无法确认是本项目。请关闭占用程序后重试。'
    }
    if (-not $proxyHealth -and (Test-PortOccupied 8787)) {
        throw '端口 8787 已被其他程序占用，无法确认是《剑问九州》AI Proxy。请关闭占用程序后重试。'
    }
    if ($frontendReady -and $proxyHealth) {
        Write-Host '本项目与 AI Proxy 已在运行，正在打开现有游戏。'
        Write-Host ($(if ($proxyHealth.aiConfigured) { '真实 AI 已配置。' } else { 'AI 服务未配置，将使用固定导演 fallback。' })) -ForegroundColor Yellow
        Open-Game
        exit 0
    }

    $manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
    $needsInstall = -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))
    foreach ($group in @($manifest.dependencies, $manifest.devDependencies)) {
        foreach ($dependency in $group.PSObject.Properties) {
            $packagePath = Join-Path $projectRoot ('node_modules/' + $dependency.Name + '/package.json')
            if (-not (Test-Path -LiteralPath $packagePath)) { $needsInstall = $true }
        }
    }
    if ($needsInstall) {
        Write-Host '首次运行或依赖不完整，正在按 package-lock.json 安装依赖，请耐心等待……'
        & $npmCommand.Source ci --include=dev
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。请检查网络和上面的 npm 提示，然后重新运行。' }
    }

    if (-not $proxyHealth) {
        Write-Host '正在启动本地 AI Proxy……'
        $tsxCli = Join-Path $projectRoot 'node_modules/tsx/dist/cli.mjs'
        $proxyScript = Join-Path $projectRoot 'server/local-ai-proxy.ts'
        $proxyProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @(
            ('"' + $tsxCli + '"'), ('"' + $proxyScript + '"')
        ) -WorkingDirectory $projectRoot -NoNewWindow -PassThru
        $proxyHealth = Wait-ForService { Get-ProxyHealth } $proxyProcess 30 '本地 AI Proxy 启动失败，请查看上方错误信息。'
    }

    if (-not $frontendReady) {
        Write-Host '正在启动本地游戏服务……'
        $viteScript = Join-Path $projectRoot 'node_modules/vite/bin/vite.js'
        $frontendProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @(
            ('"' + $viteScript + '"'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'
        ) -WorkingDirectory $projectRoot -NoNewWindow -PassThru
        [void](Wait-ForService { Test-ThisGame } $frontendProcess 60 '本地游戏服务启动失败，请查看上方错误信息。')
    }

    Write-Host ($(if ($proxyHealth.aiConfigured) { '真实 AI 已配置，剧情将自动使用 Provider。' } else { 'AI 服务未配置，游戏仍可运行并使用固定导演 fallback。' })) -ForegroundColor Yellow
    Open-Game
    $launchMutex.ReleaseMutex()
    $ownsMutex = $false
    Write-Host '前端与 AI Proxy 正在运行；请保留此窗口。'

    while ($true) {
        if ($frontendProcess) { $frontendProcess.Refresh(); if ($frontendProcess.HasExited) { throw '本地游戏服务已停止。' } }
        if ($proxyProcess) { $proxyProcess.Refresh(); if ($proxyProcess.HasExited) { throw '本地 AI Proxy 已停止。' } }
        if (-not (Test-ThisGame)) { throw '本地游戏服务不可访问。' }
        if (-not (Get-ProxyHealth)) { throw '本地 AI Proxy 不可访问。' }
        Start-Sleep -Seconds 1
    }
} catch {
    Write-Host ('启动失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    foreach ($process in @($frontendProcess, $proxyProcess)) {
        if ($process) {
            $process.Refresh()
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
        }
    }
    if ($ownsMutex) { $launchMutex.ReleaseMutex() }
    if ($launchMutex) { $launchMutex.Dispose() }
}
