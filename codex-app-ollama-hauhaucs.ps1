param(
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSCommandPath
$ollamaBaseUrl = "http://127.0.0.1:11434"
$ollamaBaseModel = "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest"
$model = $ollamaBaseModel
$modelDisplayName = "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive"
$proxyPort = 11435
$proxyBaseUrl = "http://127.0.0.1:$proxyPort/v1/"
$proxyScript = Join-Path $root "lab-setup\scripts\ollama-openai-fast-proxy.js"
$asarPatchScript = Join-Path $root "lab-setup\scripts\patch-codex-ollama-asar.js"
$warmupScript = Join-Path $root "lab-setup\scripts\start-ollama-model.ps1"
$closeWatcherScript = Join-Path $root "lab-setup\scripts\watch-codex-ollama-close.ps1"
$codexHome = Join-Path $env:USERPROFILE ".codex-ollama"
$electronUserData = Join-Path $env:APPDATA "Codex-Ollama"
$copyRoot = Join-Path $env:LOCALAPPDATA "Codex-Ollama-App\app"
$copyExe = Join-Path $copyRoot "Codex.exe"
$logDir = Join-Path $root "lab-setup\logs"
$log = Join-Path $logDir ("codex-app-ollama-hauhaucs-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Start-Transcript -Path $log -Force | Out-Null

function Wait-User {
  if (-not $NoPause) {
    Write-Host ""
    Read-Host "Presiona Enter para cerrar esta ventana"
  }
}

function Set-TextUtf8NoBom {
  param(
    [string]$Path,
    [string]$Value
  )

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $utf8NoBom)
}

function Find-InstalledCodexApp {
  $runningStoreApp = Get-CimInstance Win32_Process -Filter "name = 'Codex.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'Program Files\\WindowsApps\\OpenAI\.Codex_.*?\\app\\Codex\.exe' } |
    Select-Object -First 1

  if ($runningStoreApp -and $runningStoreApp.CommandLine -match '"([^"]*Program Files\\WindowsApps\\OpenAI\.Codex_[^"]*\\app\\Codex\.exe)"') {
    return Split-Path -Parent $Matches[1]
  }

  $candidates = Get-ChildItem -LiteralPath "C:\Program Files\WindowsApps" -Directory -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue |
    ForEach-Object {
      $exe = Join-Path $_.FullName "app\Codex.exe"
      if (Test-Path -LiteralPath $exe) {
        Get-Item -LiteralPath $exe
      }
    } |
    Sort-Object LastWriteTime -Descending

  if (-not $candidates) {
    throw "No encontre la app instalada de Codex en WindowsApps."
  }

  return Split-Path -Parent $candidates[0].FullName
}

function Stop-OllamaCodexAppProcesses {
  Get-CimInstance Win32_Process -Filter "name = 'Codex.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*Codex-Ollama-App*" -or $_.CommandLine -like "*Codex-Ollama*" } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }

  Get-CimInstance Win32_Process -Filter "name = 'codex.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*Codex-Ollama-App*" } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
}

function Test-CodexCopyCurrent {
  param([string]$SourceRoot)

  if (-not (Test-Path -LiteralPath $copyExe)) {
    return $false
  }

  $checks = @(
    @("Codex.exe", "Codex.exe"),
    @("resources\app.asar", "resources\app.asar")
  )

  foreach ($check in $checks) {
    $source = Join-Path $SourceRoot $check[0]
    $copy = Join-Path $copyRoot $check[1]
    if (-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $copy)) {
      return $false
    }

    $sourceItem = Get-Item -LiteralPath $source
    $copyItem = Get-Item -LiteralPath $copy
    if ($sourceItem.Length -ne $copyItem.Length -or $copyItem.LastWriteTime -lt $sourceItem.LastWriteTime) {
      return $false
    }
  }

  return $true
}

function Ensure-CodexCopy {
  $sourceRoot = $null
  try {
    $sourceRoot = Find-InstalledCodexApp
  } catch {
    if (Test-Path -LiteralPath $copyExe) {
      return
    }
    throw
  }

  if (Test-CodexCopyCurrent -SourceRoot $sourceRoot) {
    return
  }

  Stop-OllamaCodexAppProcesses
  Write-Host "Copiando Codex Desktop actualizado para el perfil Ollama..."
  New-Item -ItemType Directory -Path $copyRoot -Force | Out-Null
  & robocopy $sourceRoot $copyRoot /E /NFL /NDL /NJH /NJS /NP | Out-Null
  $code = $LASTEXITCODE
  if ($code -gt 7) {
    throw "Robocopy fallo con codigo $code."
  }
}

function Ensure-CodexOllamaAppPatch {
  $copyAsar = Join-Path $copyRoot "resources\app.asar"
  if (-not (Test-Path -LiteralPath $copyAsar)) {
    throw "No encontre app.asar en la copia de Codex: $copyAsar"
  }
  if (-not (Test-Path -LiteralPath $asarPatchScript)) {
    throw "No encontre el parche del dropdown Ollama: $asarPatchScript"
  }

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "No encontre node.exe para parchear la copia de Codex."
  }

  Write-Host "Verificando parche Ollama en la app duplicada..."
  & $node.Source $asarPatchScript $copyAsar
  if ($LASTEXITCODE -ne 0) {
    throw "No pude aplicar el parche Ollama en app.asar."
  }
}

function Ensure-OllamaHome {
  New-Item -ItemType Directory -Path $codexHome, $electronUserData -Force | Out-Null

  foreach ($name in @("auth.json", "AGENTS.md", "installation_id", ".personality_migration")) {
    $src = Join-Path $env:USERPROFILE ".codex\$name"
    $dst = Join-Path $codexHome $name
    if ((Test-Path -LiteralPath $src) -and -not (Test-Path -LiteralPath $dst)) {
      Copy-Item -LiteralPath $src -Destination $dst -Force
    }
  }

  $config = Join-Path $codexHome "config.toml"
  $projectPathForToml = $root.ToLowerInvariant().Replace("'", "''")
  $configText = @"
model = "$model"
model_reasoning_effort = "low"
model_provider = "ollama-launch"
openai_base_url = "$proxyBaseUrl"
forced_login_method = "api"

[windows]
sandbox = "elevated"

[projects.'$projectPathForToml']
trust_level = "trusted"

[model_providers.ollama-launch]
name = "Ollama"
base_url = "$proxyBaseUrl"
"@

  if (-not (Test-Path -LiteralPath $config)) {
    Set-Content -LiteralPath $config -Value $configText -Encoding UTF8
    return
  }

  $current = Get-Content -LiteralPath $config -Raw
  foreach ($line in $configText -split "`r?`n") {
    if ($line.Trim() -eq "") { continue }
    if ($current -notmatch [regex]::Escape($line.Trim())) {
      Set-Content -LiteralPath $config -Value $configText -Encoding UTF8
      return
    }
  }
}

function New-OllamaModelCacheEntry {
  param(
    [string]$Slug,
    [string]$DisplayName,
    [string]$Description,
    [string]$DefaultReasoning
  )

  $custom = [pscustomobject]@{
    slug = $Slug
    display_name = $DisplayName
    description = $Description
    default_reasoning_level = $DefaultReasoning
    supported_reasoning_levels = @(
      [pscustomobject]@{ effort = "low"; description = "Fast responses with lighter reasoning" },
      [pscustomobject]@{ effort = "medium"; description = "Balances speed and reasoning depth" },
      [pscustomobject]@{ effort = "high"; description = "Greater reasoning depth" },
      [pscustomobject]@{ effort = "xhigh"; description = "Extra high reasoning depth" }
    )
    base_instructions = "You are Codex running locally through Ollama. Answer clearly and concisely. Use available tools when they are needed."
    shell_type = "shell_command"
    visibility = "list"
    supported_in_api = $true
    priority = -100
    supports_reasoning_summaries = $true
    default_reasoning_summary = "none"
    support_verbosity = $true
    default_verbosity = "low"
    apply_patch_tool_type = "freeform"
    web_search_tool_type = "text_and_image"
    truncation_policy = [pscustomobject]@{ mode = "tokens"; limit = 10000 }
    supports_parallel_tool_calls = $true
    supports_image_detail_original = $true
    context_window = 8192
    max_context_window = 8192
    effective_context_window_percent = 90
    experimental_supported_tools = @()
    input_modalities = @("text")
    supports_search_tool = $true
  }

  $custom.slug = $Slug
  $custom.display_name = $DisplayName
  $custom.description = $Description
  $custom.default_reasoning_level = $DefaultReasoning
  $custom.visibility = "list"
  $custom.supported_in_api = $true
  $custom.priority = -100

  foreach ($entry in @{
    model_provider = "ollama-launch"
    provider = "ollama-launch"
    availability_nux = $null
    upgrade = $null
    additional_speed_tiers = @()
    service_tiers = @()
  }.GetEnumerator()) {
    $custom | Add-Member -MemberType NoteProperty -Name $entry.Key -Value $entry.Value -Force
  }

  return $custom
}

function Ensure-OllamaModelCache {
  $cache = Join-Path $codexHome "models_cache.json"

  $hauhaucs = New-OllamaModelCacheEntry `
    -Slug $model `
    -DisplayName $modelDisplayName `
    -Description "Local Ollama model via proxy. Single installed local model." `
    -DefaultReasoning "low"

  $catalog = [ordered]@{
    fetched_at = (Get-Date).ToUniversalTime().ToString("o")
    etag = "local-ollama-hauhaucs-tooling-v1"
    client_version = "0.131.0"
    models = @($hauhaucs)
  }

  $existing = if (Test-Path -LiteralPath $cache) { Get-Content -LiteralPath $cache -Raw } else { "" }
  $next = $catalog | ConvertTo-Json -Depth 100
  if ($existing -ne $next) {
    Set-TextUtf8NoBom -Path $cache -Value $next
  }
}

function Find-OllamaExe {
  $command = Get-Command "ollama.exe" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
    (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "No encontre ollama.exe. Instala Ollama o agrega ollama.exe al PATH."
}

function Test-OllamaServer {
  try {
    Invoke-RestMethod -Uri "$ollamaBaseUrl/api/tags" -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Ensure-OllamaServer {
  if (Test-OllamaServer) {
    return
  }

  $ollamaExe = Find-OllamaExe
  Write-Host "Iniciando Ollama local en $ollamaBaseUrl ..."

  $ollamaOut = Join-Path $logDir "ollama-serve.out.log"
  $ollamaErr = Join-Path $logDir "ollama-serve.err.log"
  Start-Process -FilePath $ollamaExe `
    -ArgumentList @("serve") `
    -WindowStyle Hidden `
    -RedirectStandardOutput $ollamaOut `
    -RedirectStandardError $ollamaErr | Out-Null

  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-OllamaServer) {
      return
    }
  }

  throw "Ollama no inicio en $ollamaBaseUrl. Revisa $ollamaErr"
}

function Test-OllamaModel {
  param([string]$Name)

  try {
    $ollamaExe = Find-OllamaExe
    & $ollamaExe show $Name *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Ensure-OllamaModelAlias {
  param(
    [string]$Alias,
    [int]$ContextWindow
  )

  if (Test-OllamaModel -Name $Alias) {
    return
  }

  if (-not (Test-OllamaModel -Name $ollamaBaseModel)) {
    Write-Host "No encontre el modelo base. Descargando $ollamaBaseModel ..."
    $ollamaExe = Find-OllamaExe
    & $ollamaExe pull $ollamaBaseModel
    if ($LASTEXITCODE -ne 0) {
      throw "No pude descargar el modelo base $ollamaBaseModel."
    }
  }

  Write-Host "Creando alias local $Alias ..."
  $safeName = ($Alias -replace '[\\/:]', '_')
  $modelfile = Join-Path $logDir "Modelfile-$safeName"
  @"
FROM $ollamaBaseModel
PARAMETER num_ctx $ContextWindow
"@ | Set-Content -LiteralPath $modelfile -Encoding UTF8

  $ollamaExe = Find-OllamaExe
  & $ollamaExe create $Alias -f $modelfile
  if ($LASTEXITCODE -ne 0) {
    throw "No pude crear el alias local $Alias."
  }
}

function Ensure-OllamaModels {
  Ensure-OllamaServer
  if (-not (Test-OllamaModel -Name $ollamaBaseModel)) {
    Write-Host "No encontre el modelo base. Descargando $ollamaBaseModel ..."
    $ollamaExe = Find-OllamaExe
    & $ollamaExe pull $ollamaBaseModel
    if ($LASTEXITCODE -ne 0) {
      throw "No pude descargar el modelo base $ollamaBaseModel."
    }
  }
}

function Test-OllamaFastProxy {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$proxyPort/health" -TimeoutSec 2
    $ids = @($health.models | ForEach-Object { $_.id })
    $proxyVersion = 0
    [int]::TryParse([string]$health.version, [ref]$proxyVersion) | Out-Null
    return ($health.ok -eq $true -and $proxyVersion -ge 26 -and $ids -contains $model)
  } catch {
    return $false
  }
}

function Ensure-OllamaFastProxy {
  if (-not (Test-Path -LiteralPath $proxyScript)) {
    throw "No encontre el proxy local: $proxyScript"
  }

  Ensure-OllamaModels

  if (Test-OllamaFastProxy) {
    return
  }

  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*ollama-openai-fast-proxy.js*" } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }

  Write-Host "Iniciando proxy local de Ollama en http://127.0.0.1:$proxyPort ..."
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue)
  if (-not $node) {
    throw "No encontre node.exe para iniciar el proxy local."
  }

  $proxyOut = Join-Path $logDir "ollama-fast-proxy.out.log"
  $proxyErr = Join-Path $logDir "ollama-fast-proxy.err.log"
  Start-Process -FilePath $node.Source `
    -ArgumentList @("`"$proxyScript`"", "--port", "$proxyPort", "--target", "http://127.0.0.1:11434", "--fast-model", $model) `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $proxyOut `
    -RedirectStandardError $proxyErr | Out-Null

  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-OllamaFastProxy) {
      return
    }
  }

  throw "El proxy local de Ollama no inicio. Revisa $proxyErr"
}

function Start-OllamaModelWarmup {
  if (-not (Test-Path -LiteralPath $warmupScript)) {
    Write-Host "No encontre warmup script: $warmupScript"
    return
  }

  $powershell = (Get-Command powershell.exe -ErrorAction SilentlyContinue)
  if (-not $powershell) {
    Write-Host "No encontre powershell.exe para precargar el modelo."
    return
  }

  Write-Host "Precargando modelo local en segundo plano..."
  Start-Process -FilePath $powershell.Source `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", "`"$warmupScript`"",
      "-Model", "`"$model`"",
      "-OllamaBaseUrl", "`"$ollamaBaseUrl`"",
      "-KeepAlive", "30m",
      "-LogDir", "`"$logDir`""
    ) `
    -WindowStyle Hidden | Out-Null
}

function Start-OllamaCloseWatcher {
  if (-not (Test-Path -LiteralPath $closeWatcherScript)) {
    Write-Host "No encontre close watcher: $closeWatcherScript"
    return
  }

  $powershell = (Get-Command powershell.exe -ErrorAction SilentlyContinue)
  if (-not $powershell) {
    Write-Host "No encontre powershell.exe para vigilar cierre."
    return
  }

  Write-Host "Activando apagado automatico de la LLM al cerrar Codex Ollama..."
  Start-Process -FilePath $powershell.Source `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", "`"$closeWatcherScript`"",
      "-Model", "`"$model`"",
      "-CopyRoot", "`"$copyRoot`"",
      "-ElectronUserData", "`"$electronUserData`"",
      "-ProxyPort", "$proxyPort",
      "-LogDir", "`"$logDir`"",
      "-StopProxy"
    ) `
    -WindowStyle Hidden | Out-Null
}

try {
  Write-Host ""
  Write-Host "Codex App Ollama HauhauCS"
  Write-Host "Workspace: $root"
  Write-Host "Modelo: $model"
  Write-Host "Proxy: $proxyBaseUrl"
  Write-Host "Codex Home: $codexHome"
  Write-Host "Electron Data: $electronUserData"
  Write-Host "App copy: $copyExe"
  Write-Host "Log: $log"
  Write-Host ""

  Ensure-CodexCopy
  Ensure-OllamaHome
  Ensure-OllamaModelCache
  Ensure-OllamaFastProxy
  Start-OllamaModelWarmup

  $env:CODEX_HOME = $codexHome
  $env:CODEX_ELECTRON_USER_DATA_PATH = $electronUserData
  $env:OPENAI_API_KEY = "ollama-local"

  Stop-OllamaCodexAppProcesses
  Write-Host "Abriendo Codex Desktop duplicado con perfil Ollama..."
  $appOut = Join-Path $logDir ("codex-ollama-app-{0}.out.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  $appErr = Join-Path $logDir ("codex-ollama-app-{0}.err.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  Start-Process -FilePath $copyExe `
    -ArgumentList @("--user-data-dir", $electronUserData, $root) `
    -WorkingDirectory $root `
    -RedirectStandardOutput $appOut `
    -RedirectStandardError $appErr | Out-Null
  Start-OllamaCloseWatcher

  Write-Host ""
  Write-Host "Listo. Esta ventana abre la app duplicada; no cambia el perfil GPT-5.5."
  Write-Host "Al cerrar Codex Ollama, el watcher descargara la LLM y apagara el proxy local."
  Write-Host "Logs internos de la app:"
  Write-Host "  $appOut"
  Write-Host "  $appErr"
  Write-Host "Para verificar que uso Ollama despues de mandar un mensaje:"
  Write-Host "  ollama ps"
  Write-Host "Para verificar el proxy rapido:"
  Write-Host "  Invoke-RestMethod http://127.0.0.1:$proxyPort/health"
} finally {
  try { Stop-Transcript | Out-Null } catch {}
}

Wait-User
