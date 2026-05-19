# Arquitectura

## Componentes

Seguro:

- `codex-app-ollama-hauhaucs.ps1` es el launcher principal.
- `lab-setup/scripts/ollama-openai-fast-proxy.js` es el proxy local.
- `%USERPROFILE%\.codex-ollama\config.toml` apunta Codex al proxy local.
- `%USERPROFILE%\.codex-ollama\models_cache.json` publica el modelo local en Codex.
- `%APPDATA%\Codex-Ollama` separa datos de ventana/sesion Electron.
- `%LOCALAPPDATA%\Codex-Ollama-App\app` contiene la copia local de Codex Desktop.

## Flujo

```text
Codex Ollama clone
  -> OpenAI-compatible local endpoint
  -> http://127.0.0.1:11435/v1/
  -> ollama-openai-fast-proxy.js
  -> http://127.0.0.1:11434/api/chat
  -> Ollama model
```

## Tool-calls

Seguro:

- El proxy convierte requests de `/v1/responses` y `/v1/chat/completions` hacia Ollama.
- El proxy anuncia el modelo local.
- El proxy traduce una herramienta de terminal generica como `shell_command`.
- El proxy vuelve a traducir la llamada para Codex como `exec_command` cuando Codex espera ese nombre.
- El proxy oculta herramientas para saludos y conversacion corta.
- El proxy aplica presupuesto de herramientas por turno para evitar loops.

Suposicion:

- No todas las herramientas internas de Codex son equivalentes en Ollama.
- La terminal es el camino principal para darle "manos y ojos" al modelo local.

## Version actual del proxy

```text
25
```

Cambios importantes de esta version:

- Respuestas estaticas para identidad del modelo local.
- Bloqueo de instrucciones operativas para armas CBRN.
- Streaming con heartbeats para reducir reconnects.
- Tool budget para evitar vueltas infinitas.
- Comando unico para specs de PC con JSON compacto.
- Campo `MemoryTypeName` para no inferir tipo de RAM por velocidad.

