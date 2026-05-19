# Seguridad y limites

Este kit es para laboratorio local y trabajo autorizado.

Seguro:

- El modelo corre localmente en Ollama.
- El launcher separa el perfil Ollama del perfil GPT normal.
- El proxy incluye una respuesta de seguridad para peticiones operativas de armas CBRN.
- No se deben subir `logs`, `auth.json`, bases SQLite ni carpetas de perfil.

Suposicion:

- Un modelo local puede alucinar su identidad o capacidades.
- Un modelo local puede pedir comandos innecesarios o tardar mucho si el prompt es amplio.

Buenas practicas:

- Usa repos privados si vas a agregar configuraciones personales.
- No comitees tokens, passwords, PINs, logs o bases de datos de Codex.
- Ejecuta acciones de seguridad solo en sistemas propios o con permiso explicito.
- Revisa manualmente comandos destructivos antes de ejecutarlos.

