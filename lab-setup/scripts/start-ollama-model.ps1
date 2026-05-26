param(
  [Parameter(Mandatory = $true)][string]$Model,
  [string]$OllamaBaseUrl = "http://127.0.0.1:11434",
  [string]$KeepAlive = "30m",
  [string]$LogDir = ""
)

$ErrorActionPreference = "Continue"

if (-not $LogDir) {
  $LogDir = Join-Path $env:TEMP "codex-ollama-logs"
}
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$log = Join-Path $LogDir ("ollama-model-warmup-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
Start-Transcript -Path $log -Force | Out-Null

try {
  Write-Host "Warming Ollama model: $Model"
  $body = @{
    model = $Model
    prompt = ""
    stream = $false
    keep_alive = $KeepAlive
  } | ConvertTo-Json -Depth 8

  Invoke-RestMethod `
    -Method Post `
    -Uri "$OllamaBaseUrl/api/generate" `
    -ContentType "application/json" `
    -Body $body `
    -TimeoutSec 900 | Out-Null

  Write-Host "Ollama model is warm: $Model"
} catch {
  Write-Host "Warmup failed: $($_.Exception.Message)"
} finally {
  try { Stop-Transcript | Out-Null } catch {}
}
