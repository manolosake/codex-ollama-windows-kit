# codex-ollama-windows-kit

Kit reproducible para abrir una copia separada de Codex Desktop en Windows usando Ollama como backend local.

## Que hace

Seguro:

- Mantiene Codex normal separado en `%USERPROFILE%\.codex`.
- Crea/usa un perfil local separado en `%USERPROFILE%\.codex-ollama`.
- Crea/usa datos de Electron separados en `%APPDATA%\Codex-Ollama`.
- Copia la app oficial de Codex a `%LOCALAPPDATA%\Codex-Ollama-App\app`.
- Levanta un proxy local OpenAI-compatible en `http://127.0.0.1:11435/v1/`.
- Configura el modelo local `fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest`.
- Publica el modelo en el dropdown de Codex como modelo local.
- Traduce tool-calls basicos entre Codex y Ollama para que el modelo pueda pedir terminal cuando Codex le expone herramientas.
- Incluye `kali-ollama.cmd`, un operador compacto para controlar la VM Kali desde Codex Ollama con salidas JSON.

Suposicion:

- Si OpenAI cambia internamente la app de Codex, puede cambiar como se leen los modelos locales o el cache del dropdown.
- En equipos sin GPU NVIDIA, este modelo de 35B puede tardar varios minutos por respuesta.

## Requisitos

- Windows 11.
- Codex Desktop instalado y funcionando con tu cuenta normal.
- Ollama instalado.
- Node.js instalado y disponible como `node.exe`.
- Espacio libre suficiente para el modelo local. En esta maquina el modelo cargado ocupa alrededor de 24 GB.

## Uso rapido

1. Clona o copia este repo.
2. Abre PowerShell en la carpeta del repo.
3. Ejecuta:

```powershell
.\codex-app-ollama-hauhaucs.cmd
```

El launcher hace desde frio:

- Busca la app oficial de Codex.
- Refresca la copia local del clon si Codex se actualizo.
- Crea el perfil `%USERPROFILE%\.codex-ollama`.
- Arranca Ollama si no esta corriendo.
- Descarga el modelo si no existe.
- Arranca el proxy local.
- Precarga el modelo local en segundo plano.
- Abre Codex duplicado con perfil Ollama.
- Vigila el cierre de Codex Ollama y descarga la LLM con `ollama stop`.

## Verificar

```powershell
.\scripts\verify-codex-ollama.ps1
```

Tambien puedes revisar manualmente:

```powershell
Invoke-RestMethod http://127.0.0.1:11435/health
ollama ps
```

Verificar Kali VM para Codex Ollama:

```powershell
.\kali-ollama.cmd status
.\kali-ollama.cmd quickcheck
```

Resultado esperado del proxy:

```text
version = 29
default_model = fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest
```

## Codex normal

Para restaurar/abrir Codex normal con GPT-5.5 desde esta carpeta:

```powershell
.\codex-app-gpt55.cmd
```

Seguro:

- El launcher de Ollama no cambia el perfil GPT normal.
- El script GPT solo limpia valores de Ollama en `%USERPROFILE%\.codex\config.toml` y fija `gpt-5.5`.

## Apagado automatico de la LLM

Seguro:

- Al abrir Codex Ollama, el launcher inicia Ollama/proxy y precarga el modelo en segundo plano.
- Al cerrar todas las ventanas/procesos del clon Codex Ollama, un watcher oculto ejecuta `ollama stop` para descargar el modelo.
- El watcher tambien apaga el proxy local del clon.

Suposicion:

- Si otro programa esta usando el mismo modelo de Ollama al mismo tiempo, `ollama stop` puede afectar tambien esa sesion local.

## Documentacion

- [Instalacion](docs/INSTALL-WINDOWS.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Operacion](docs/OPERATIONS.md)
- [Kali operator](docs/KALI-OPERATOR.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Notas de seguridad](docs/SECURITY.md)
