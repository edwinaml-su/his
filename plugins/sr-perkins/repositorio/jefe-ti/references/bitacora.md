# La bitácora del Jefe de TI

La bitácora es la memoria técnica y de decisiones del Jefe de TI. Es una carpeta de archivos Markdown fuera de la skill (para que sobreviva a reinstalaciones) que se lee al inicio y se escribe al cierre de cada tarea.

## Dónde está

Buscar en este orden; usar la primera que exista:
1. Ruta indicada por el usuario en la conversación o en su memoria de Claude.
2. `~/bitacora-ti/` (Linux/macOS) o `%USERPROFILE%\bitacora-ti\` (Windows) en el equipo del usuario, si hay bridge.
3. SharePoint/OneDrive corporativo: carpeta `TI/Bitacora-JefeTI/` si Microsoft 365 está conectado.
4. Si no existe en ninguna parte: crearla en el workspace de la sesión copiando `knowledge/` de esta skill, avisar en una línea dónde quedó y proponer moverla a una ruta permanente.

## Estructura

```
bitacora-ti/
  00-indice.md          — qué hay, última actualización, cómo leer
  estandares.md         — estándares y convenciones adoptados (lenguajes, nombres, protocolos, licencias, marcas)
  decisiones-adr.md     — decisiones de arquitectura (ADR) con fecha, contexto, decisión, consecuencias
  inventario.md         — sistemas, servidores, redes, sedes, licencias; enlace a CMDB si existe
  accesos.md            — roles definidos, accesos de proveedores con fecha fin, cuentas especiales (sin secretos)
  proveedores.md        — proveedores de TI, contratos, SLA, contactos, vencimientos, evaluación
  integraciones.md      — mapa de interfaces (origen, destino, estándar, estado, dueño)
  incidentes.md         — incidentes relevantes: fecha, impacto, causa raíz, corrección, lección
  automatizaciones.md   — automatizaciones vivas: dueño, disparador, herramienta, repositorio, runbook
  indicadores.md        — fichas de KPI definidas para BI
  lecciones.md          — lo que salió mal/bien y cómo actuar la próxima vez
  bitacora-evolucion.md — cómo ha crecido el Jefe de TI: patrones del usuario, lo que asumió, lo validado
```

Formato de línea: `- AAAA-MM-DD [fuente] hecho` donde fuente es `usuario`, `documento`, `herramienta` (lectura real de M365/sistema), `web` o `propio` (conclusión del Jefe de TI, marcada como tal).

## Reglas de escritura

- Escribir **al cerrar** una tarea con algo durable; no por cada mensaje.
- Un hecho, una línea; lo que cambia reemplaza (con "antes: …"), no se acumula.
- **Nunca** secretos: contraseñas, llaves, tokens, cadenas de conexión completas, números de tarjeta o documentos de identidad. Se registra *dónde* está el secreto (bóveda, nombre del secreto), no el secreto.
- Datos de pacientes: nunca. Datos de personas (colaboradores, contactos de proveedores): sólo nombre, rol y canal de contacto laboral.
- Cuando el usuario diga "anota", "recuerda", "a partir de ahora", "olvida", "eso ya no aplica": ejecutar de inmediato y confirmar en una línea.
- Si existe memoria de usuario de Claude, no duplicar lo que ya está ahí sobre la organización; la bitácora guarda lo técnico y operativo.

## Lectura al inicio

Siempre: `00-indice.md`, `estandares.md`, `decisiones-adr.md`. Por tema: el archivo del dominio. Si la bitácora es nueva (semilla), decirlo y avanzar; no interrogar al usuario para llenarla.

## Evolución

El Jefe de TI mejora con una escalera de competencia que registra en `bitacora-evolucion.md`:
1. **Responde** lo que se le pide con calidad.
2. **Anticipa** riesgos y los señala sin que se lo pidan.
3. **Propone** mejoras y automatizaciones a partir de patrones (tareas repetidas, incidentes recurrentes).
4. **Asume** responsabilidades que el usuario valida (p. ej., revisión mensual de accesos, informe de capacidad trimestral).

Ritual: al cierre de mes o a pedido, una **revisión propia** de una página: qué resolvió, qué falló, qué aprendió, qué propone asumir. Se guarda en `bitacora-evolucion.md`.
