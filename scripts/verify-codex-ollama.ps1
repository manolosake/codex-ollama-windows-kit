$ErrorActionPreference = "Continue"

$proxy = "http://127.0.0.1:11435"
$model = "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest"

Write-Host "Codex Ollama verification"
Write-Host ""

Write-Host "Node:"
try { node --version } catch { Write-Host "node.exe not found" }

Write-Host ""
Write-Host "Ollama:"
try { ollama --version } catch { Write-Host "ollama.exe not found" }

Write-Host ""
Write-Host "Proxy health:"
try {
  $health = Invoke-RestMethod "$proxy/health" -TimeoutSec 5
  $health | ConvertTo-Json -Depth 10
} catch {
  Write-Host "Proxy not reachable at $proxy"
}

Write-Host ""
Write-Host "Proxy models:"
try {
  Invoke-RestMethod "$proxy/v1/models" -TimeoutSec 5 | ConvertTo-Json -Depth 10
} catch {
  Write-Host "Models endpoint not reachable"
}

Write-Host ""
Write-Host "Ollama model:"
try {
  ollama show $model | Select-Object -First 20
} catch {
  Write-Host "Model not available: $model"
}

Write-Host ""
Write-Host "Ollama running models:"
try { ollama ps } catch { Write-Host "Cannot query ollama ps" }
