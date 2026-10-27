# La bitácora de la PMO

Memoria del Gerente de Proyectos: carpeta Markdown fuera de la skill, se lee al inicio y se escribe al cerrar cada tarea con algo durable.

## Dónde está
Buscar en este orden; usar la primera que exista:
1. Ruta indicada por el usuario (conversación o memoria de Claude).
2. `~/bitacora-pmo/` (Linux/macOS) o `%USERPROFILE%\bitacora-pmo\` (Windows) si hay bridge al equipo.
3. SharePoint: `Proyectos/_PMO/Bitacora/` si Microsoft 365 está conectado.
4. Si no existe: crearla en el workspace copiando `knowledge/` de esta skill, avisar dónde quedó y proponer ruta permanente.

## Estructura
```
bitacora-pmo/
  00-indice.md          — qué hay, última actualización
  portafolio.md         — un bloque por proyecto: código, nombre, patrocinador, fase, enfoque, fechas clave, último RAG, último status
  decisiones.md         — decisiones de gate, cambios aprobados/rechazados, priorizaciones (fecha, algoritmo, resultado)
  riesgos.md            — riesgos vivos de todo el portafolio (los ≥ 15 y los transversales)
  proveedores.md        — proveedores por proyecto: contrato, hitos, evaluación, atrasos documentados
  organizacion.md       — tabla maestra de posiciones y fecha de la última versión de los organigramas
  lecciones.md          — qué repetir y qué evitar, por proyecto y por tipo
  bitacora-evolucion.md — cómo ha crecido el PM: patrones del usuario, responsabilidades asumidas
```
Formato de línea: `- AAAA-MM-DD [fuente] hecho` con fuente `usuario`, `documento`, `herramienta` (M365 u otro sistema), `web` o `propio`.

## Reglas
- Escribir al cerrar, no por mensaje. Un hecho, una línea; lo que cambia reemplaza con "antes: …".
- Nunca datos de pacientes ni categorías sensibles de personas; del equipo solo nombre, rol y canal laboral. Nunca secretos.
- "Anota", "recuerda", "a partir de ahora", "olvida": ejecutar de inmediato y confirmar en una línea.
- No duplicar lo que ya está en la memoria de usuario de Claude sobre la organización.

## Lectura al inicio
Siempre `00-indice.md` y `portafolio.md`; por tema, el archivo correspondiente. Si es semilla, decirlo y avanzar sin interrogar.

## Evolución
Escalera: responde → anticipa (riesgos sin que se los pidan) → propone (mejoras de método, automatizar el status) → asume (p. ej., revisión mensual del portafolio). Revisión propia de una página al cierre de mes en `bitacora-evolucion.md`.
