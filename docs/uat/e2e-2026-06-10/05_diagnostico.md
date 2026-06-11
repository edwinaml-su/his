# Flujo 5 — DIAGNÓSTICO (Farmacia, eMAR, LIS, Imagen, Respiratorio, Nutrición)

**Estado global: PASS** · 7/7 vistas funcionales · 0 errores.

| # | Ruta | Vista | Resultado |
|---|---|---|---|
| 5.1 | `/pharmacy` | Farmacia · Recetas — recetas activas y trazabilidad de despachos (**TDR §15**). Filtros por encuentro/paciente/prescriptor. | PASS |
| 5.2 | `/emar` | eMAR — registro electrónico de administración de medicamentos (**§16**). "Nueva administración". | PASS |
| 5.3 | `/lis/results` | Resultados pendientes de validación (LIS) — cola de validación (4-ojos, ADR-0002). Tabla Paciente/Test/Valor/Flag/Antigüedad. 0 pendientes. | PASS |
| 5.4 | `/imaging` | Imagenología (RIS/PACS) — órdenes de estudios de imagen (**§18**). Filtros por estado/modalidad. | PASS |
| 5.5 | `/respiratory` | Terapia respiratoria — órdenes de O₂, ventilación, nebulización, CPAP/BIPAP (**§21**). | PASS |
| 5.6 | `/nutrition` | Nutrición — planes dietéticos, valoraciones, órdenes enteral/parenteral (**§22**). | PASS |
| 5.7 | `/pharmacy/unidosis` | Farmacia · Unidosis — Proceso C GS1, re-empaque por paciente con trazabilidad QR (**TDR §15**). Formulario con GTIN/lote origen, cantidad, expiry máx 72 h. | PASS |

## Hallazgos
Ninguno. Cobertura completa de los módulos diagnósticos/terapéuticos con referencias TDR/§ correctas.
