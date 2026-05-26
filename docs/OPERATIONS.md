# Operacion

## Abrir desde frio

```powershell
.\codex-app-ollama-hauhaucs.cmd
```

Este comando debe prender lo necesario:

- Ollama server.
- Proxy local.
- Precarga del modelo local.
- App duplicada de Codex.
- Watcher de cierre para descargar la LLM al salir.

## Health check

```powershell
Invoke-RestMethod http://127.0.0.1:11435/health
```

Esperado:

```text
ok = true
version = 29
default_model = fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest
```

## Ver modelo cargado

```powershell
ollama ps
```

## Controlar Kali desde Codex Ollama

Usa el operador compacto:

```powershell
.\kali-ollama.cmd status
.\kali-ollama.cmd start
.\kali-ollama.cmd quickcheck
.\kali-ollama.cmd tools
.\kali-ollama.cmd run "whoami; uname -r"
.\kali-ollama.cmd gui
.\kali-ollama.cmd stop
```

Seguro:

- Devuelve JSON compacto.
- No debe inventar resultados: si `ok=false` o no hay evidencia en `stdout`, la accion no esta probada.
- Es mejor para la LLM local que usar SSH/Hyper-V crudo.

## Apagar la LLM manualmente

El watcher lo hace automaticamente al cerrar Codex Ollama. Si quieres hacerlo a mano:

```powershell
ollama stop "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest"
```

Verifica:

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
