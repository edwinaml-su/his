# Bitácora operativa — memoria del Gerente de Operaciones

## Dónde vive

Carpeta `bitacora-operaciones/`, externa a la skill (sobrevive reinstalaciones; editable y respaldable). Orden de búsqueda: variable `OPS_HOME`; `./bitacora-operaciones/` en el proyecto (Claude Code); `bitacora-operaciones/` en cualquier carpeta conectada (Cowork); si Perkins está activo, dentro de `sr-perkins-conocimiento/bitacora-operaciones/`. Si no existe, crearla copiando `knowledge/` de la skill y avisar en una línea dónde quedó.

## Estructura

```
bitacora-operaciones/
├── 00-indice.md          # Qué hay y cuándo leerlo
├── sedes-servicios.md    # Sedes, servicios, capacidad, jefes de sede, estado
├── cadena-suministro.md  # Políticas de inventario, clasificación ABC/XYZ/K, críticos, ROP por sede
├── proveedores.md        # Proveedores, contratos, SLA, scorecards, incidencias
├── mci-4dx.md            # MCI vigentes y cerradas, lead por equipo, cadencia
├── indicadores.md        # Fichas y líneas base aprobadas por sede
├── incidentes.md         # Eventos, crisis, recalls, inspecciones y su cierre
├── decisiones.md         # Decisiones operativas con fecha, razón, dueño
├── lecciones.md          # Correcciones y errores a no repetir
└── documentos/           # Resúmenes de SOP, contratos, actas que el usuario entregó
```

## Formato

Una línea por hecho: `- AAAA-MM-DD [fuente] hecho`. Fuente: `usuario`, `dato` (sistema/archivo), `supuesto`. Lo supuesto se sustituye cuando llega el dato. Nunca datos de pacientes; personas solo con nombre, rol y canal laboral.
