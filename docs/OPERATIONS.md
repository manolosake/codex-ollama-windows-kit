# Operacion

## Abrir desde frio

```powershell
.\codex-app-ollama-hauhaucs.cmd
```

Este comando debe prender lo necesario:

- Ollama server.
- Proxy local.
- App duplicada de Codex.

## Health check

```powershell
Invoke-RestMethod http://127.0.0.1:11435/health
```

Esperado:

```text
ok = true
version = 25
default_model = fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest
```

## Ver modelo cargado

```powershell
ollama ps
```

## Reiniciar solo el proxy

```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*ollama-openai-fast-proxy.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

.\codex-app-ollama-hauhaucs.cmd
```

## Probar el endpoint local

```powershell
$body = @{
  model = "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest"
  stream = $false
  input = @(@{ type = "message"; role = "user"; content = "hola, quien eres" })
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:11435/v1/responses" `
  -ContentType "application/json" `
  -Body $body
```

