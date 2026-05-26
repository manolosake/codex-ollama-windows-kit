# Troubleshooting

## `codex` no reconocido

Seguro:

- Este kit no depende del comando `codex` en PATH para abrir el clon.
- Usa la app `Codex.exe` copiada desde la instalacion oficial.

Solucion:

```powershell
.\codex-app-ollama-hauhaucs.cmd
```

## El proxy no inicia

Verifica Node.js:

```powershell
node --version
```

Verifica logs:

```powershell
Get-Content .\lab-setup\logs\ollama-fast-proxy.err.log -Tail 80
```

## Ollama no inicia

Verifica:

```powershell
ollama --version
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

## No aparece el modelo en dropdown

Seguro:

- El launcher escribe `%USERPROFILE%\.codex-ollama\models_cache.json`.
- El proxy tambien anuncia el modelo en `/v1/models`.

Prueba:

```powershell
Invoke-RestMethod http://127.0.0.1:11435/v1/models
```

Luego cierra solo la ventana Codex Ollama y abre:

```powershell
.\codex-app-ollama-hauhaucs.cmd
```

## Respuestas lentas

Seguro:

- El modelo local es grande.
- Si `ollama ps` muestra `100% CPU`, no esta usando GPU dedicada.

Suposicion:

- En una laptop sin GPU NVIDIA, algunas respuestas pueden tardar minutos.

## La LLM queda prendida despues de cerrar Codex Ollama

Verifica si queda cargada:

```powershell
ollama ps
```

Apagala manualmente:

```powershell
ollama stop "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest"
```

Revisa el log del watcher:

```powershell
Get-ChildItem .\lab-setup\logs\codex-ollama-close-watch-*.log |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 |
  Get-Content -Tail 80
```

## Reconnecting en Codex Ollama

Seguro:

- El proxy version 26 usa heartbeats en streaming y tool-calls directos para acciones simples de Kali.

Revisa:

```powershell
Invoke-RestMethod http://127.0.0.1:11435/health
Get-Content .\lab-setup\logs\ollama-fast-proxy.err.log -Tail 80
```
