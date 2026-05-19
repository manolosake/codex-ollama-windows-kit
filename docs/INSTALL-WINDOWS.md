# Instalacion en Windows

## 1. Instalar prerequisitos

Seguro:

- Necesitas Codex Desktop instalado.
- Necesitas Ollama instalado.
- Necesitas Node.js instalado.

Comandos utiles para verificar:

```powershell
node --version
ollama --version
```

## 2. Descargar el modelo

El launcher lo descarga si falta, pero puedes hacerlo antes:

```powershell
ollama pull fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest
```

## 3. Abrir el clon de Codex Ollama

Desde la carpeta del repo:

```powershell
.\codex-app-ollama-hauhaucs.cmd
```

## 4. Confirmar que esta usando Ollama

Despues de mandar un mensaje en Codex Ollama:

```powershell
ollama ps
```

Debe aparecer:

```text
fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest
```

## 5. Abrir Codex normal

```powershell
.\codex-app-gpt55.cmd
```

Seguro:

- Codex normal y Codex Ollama usan perfiles separados.
- Pueden estar abiertos al mismo tiempo cuando Windows lo permite.

