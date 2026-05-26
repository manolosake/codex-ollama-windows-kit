# Kali operator para Codex Ollama

Este repo incluye un operador compacto para que Codex Ollama controle Kali sin improvisar comandos largos.

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

## Seguro

- El operador devuelve JSON compacto.
- `status` no debe lanzar ataques ni comandos externos; solo revisa Hyper-V/SSH.
- `run` ejecuta un solo comando dentro de Kali por SSH.
- El proxy local instruye a Codex Ollama a usar este operador antes que SSH o Hyper-V crudos.

## Suposicion

- Si la VM cambia de nombre, hay que actualizar `$VmName` en `lab-setup/scripts/kali-operator.ps1`.
- Si cambia el usuario o llave SSH, hay que actualizar `$VmUser` o `$Key`.

## Regla para la LLM

```text
Si no hay JSON/stdout/stderr que pruebe el resultado, no afirmes que funciono.
```

