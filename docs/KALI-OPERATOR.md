# Kali operator para Codex Ollama

Este repo incluye un operador compacto para que Codex Ollama controle Kali sin improvisar comandos largos.

## Como se conecta

Seguro:

- La entrada humana y para Codex Ollama es `.\kali-ollama.cmd`.
- Ese `.cmd` llama a `lab-setup/scripts/kali-operator.ps1`.
- El operador controla la VM de Hyper-V llamada `kali-linux-2026.1-hyperv-amd64`.
- El usuario SSH configurado dentro de Kali es `kali`.
- La llave SSH esperada en Windows es `%USERPROFILE%\.ssh\kali_lab_ed25519`.
- El operador busca la IP de Kali en este orden:
  - cache local `lab-setup/.kali-vm-ip`
  - IPs reportadas por Hyper-V
  - IP conocida de respaldo en el script
  - candidatos ARP con MAC de Hyper-V
- Cuando encuentra una IP que responde por SSH, la guarda en `lab-setup/.kali-vm-ip`.
- `run`, `quickcheck` y `tools` ejecutan comandos dentro de Kali por SSH.
- `gui` abre `vmconnect.exe` contra la VM local.

Suposicion:

- En esta maquina la IP actual probada fue `172.26.12.23`, pero puede cambiar despues de reinicios o cambios de red.
- Si recreas la VM, cambias usuario, cambias llave SSH o cambias el nombre de la VM, debes actualizar las variables al inicio de `lab-setup/scripts/kali-operator.ps1`.

## Comando base

```powershell
.\kali-ollama.cmd status
```

## Acciones

```powershell
.\kali-ollama.cmd status
.\kali-ollama.cmd start
.\kali-ollama.cmd quickcheck
.\kali-ollama.cmd tools
.\kali-ollama.cmd run "whoami; uname -r"
.\kali-ollama.cmd gui
.\kali-ollama.cmd stop
```

## Ejemplos de uso desde Codex Ollama

Puedes pedirlo en lenguaje natural:

```text
revisa el status de la VM Kali
```

```text
revisa que herramientas de pentesting tiene Kali instaladas
```

```text
corre en Kali: whoami; uname -r; ip addr
```

```text
abre la interfaz grafica de Kali
```

El proxy debe convertir esas peticiones a una llamada al operador, por ejemplo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\ruta\al\repo\lab-setup\scripts\kali-operator.ps1" status
```

## Salida esperada

`status` devuelve JSON compacto. Ejemplo:

```json
{
  "ok": true,
  "action": "status",
  "vm_name": "kali-linux-2026.1-hyperv-amd64",
  "ssh_ok": true,
  "ssh_ip": "172.26.12.23",
  "hyperv": {
    "available": true,
    "state": "Running",
    "memory_assigned_mb": 2048
  }
}
```

`tools` devuelve en `stdout` una lista simple:

```text
nmap=present
ffuf=present
sqlmap=present
hydra=present
msfconsole=present
python3=present
```

## Seguro

- El operador devuelve JSON compacto.
- `status` no debe lanzar ataques ni comandos externos; solo revisa Hyper-V/SSH.
- `run` ejecuta un solo comando dentro de Kali por SSH.
- El proxy local instruye a Codex Ollama a usar este operador antes que SSH o Hyper-V crudos.
- El proxy resume respuestas del operador Kali directamente cuando detecta JSON de Kali, para reducir alucinaciones.
- El proxy solo debe resumir output de herramienta del turno actual, no salidas viejas del chat.

## Suposicion

- Si la VM cambia de nombre, hay que actualizar `$VmName` en `lab-setup/scripts/kali-operator.ps1`.
- Si cambia el usuario o llave SSH, hay que actualizar `$VmUser` o `$Key`.

## Troubleshooting rapido

Si Codex Ollama repite una salida vieja:

```powershell
Invoke-RestMethod http://127.0.0.1:11435/health
```

Debe mostrar `version = 29` o superior.

Si SSH no conecta:

```powershell
.\kali-ollama.cmd status
.\kali-ollama.cmd ip
```

Revisa que `ssh_key_exists=true` y que `ssh_ok=true`.

## Regla para la LLM

```text
Si no hay JSON/stdout/stderr que pruebe el resultado, no afirmes que funciono.
```
