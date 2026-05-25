# Integración SRS — Registro Sanitario de Medicamentos (El Salvador)

**Fuente oficial:** Superintendencia de Regulación Sanitaria (SRS) — antes DNM (Dirección Nacional de Medicamentos), fusionada en SRS desde 2024-08-07.

**Propósito:** consulta read-only del padrón oficial de medicamentos con registro sanitario vigente, usada como base de catálogo para la creación del modelo `Drug` en HIS.

**Alcance:** lectura por demanda (búsqueda + detalle). No hay endpoint público de descarga masiva del padrón.

---

## 1. Endpoints descubiertos

| Operación | Método | URL | Notas |
|---|---|---|---|
| **Búsqueda + listado** | GET | `https://expedientes.srs.gob.sv/productos/lista` | DataTables server-side. Devuelve JSON. |
| **Detalle producto** | GET | `https://expedientes.srs.gob.sv/productos/infogeneral?param={registroSanitario}` | JSON `{status:200, data:{...}}` con secciones anidadas. |
| **Ficha técnica PDF** | GET | `https://expedientes.srs.gob.sv/productos/consultarficha?idProducto={tokenLaravel}` | Binario application/pdf. Token encriptado Laravel. |
| **Expediente electrónico PDF** | GET | `https://expedientes.srs.gob.sv/productos/detalles/pdf/{tokenLaravel}` | Binario PDF. |
| **Informe de evaluación PDF** | GET | `https://expedientes.srs.gob.sv/productos/informeevaluacion?idProducto={tokenLaravel}` | Binario PDF. |
| **UI buscador (HTML público)** | GET | `https://expedientes.srs.gob.sv/productos/buscarProducto` | Form HTML embebido. |
| **Portal PVMP precios** | GET | `https://info.srs.gob.sv/` | Distinto al padrón — consulta de precios máximos de venta + farmacias con stock. |

**Sin API oficial documentada.** Los endpoints listados se identificaron por reverse engineering del HTML/JS del buscador público. No hay autenticación, no hay rate-limit publicado, no hay versionado de contrato. Sujeto a cambios sin previo aviso por SRS.

---

## 2. Parámetros del endpoint `/productos/lista`

Query string:

| Parámetro | Tipo | Valores | Obligatorio |
|---|---|---|---|
| `filtro` | string | `nombre_comercial` \| `id_producto` \| `principio_activo` | sí |
| `busqueda` | string | texto libre (mínimo 1 caracter) | sí |
| `estado` | string | `""` (todos) \| `ACTIVO` \| `ELIMINADO` \| `CANCELADO` \| `SUSPENDIDO` | no |
| `draw` | int | identificador DataTables (default `1`) | sí para DataTables |
| `start` | int | offset paginación | sí |
| `length` | int | page size (UI default `6`, no probado límite superior) | sí |

**Ejemplo verificado** (24 mayo 2026):

```
GET https://expedientes.srs.gob.sv/productos/lista?filtro=nombre_comercial&busqueda=paracetamol&estado=ACTIVO&draw=1&start=0&length=6

→ recordsTotal: 36
→ data: [ {idProducto, registroSanitario, ...}, ... ]
```

---

## 3. Esquema JSON respuesta `/productos/lista` (un registro)

| Campo SRS | Tipo | Ejemplo | Notas |
|---|---|---|---|
| `idProducto` | string (ULID) | `01hjy72kg400mv63atbgxtt8rw` | ID interno SRS. Único. Estable. |
| `registroSanitario` | string | `F050010092003` | **N° de registro oficial.** Formato `F` + 6 dígitos secuencia + 2 dígitos mes + 4 dígitos año primera autorización. |
| `nombreRegistro` | string | `TIALGIN (PARACETAMOL) 1 G COMPRIMIDOS MONTE VERDE` | Nombre comercial completo (frecuente incluye principio activo + dosis + forma + titular concatenados). |
| `vidaUtil` | string | `24 MESES` \| `2 AÑOS` \| `36 MESES` | Texto libre. No estandarizado. Requiere parseo. |
| `viaAdministracion` | string \| null | `null` en listado | En el listado viene `null`; consultar detalle. |
| `categoria` | string | `SÍNTESIS QUÍMICA` \| `BIOLÓGICO` \| ... | Catálogo cerrado SRS, no documentado. |
| `clasificacion` | string | `MULTIORIGEN` \| `INNOVADOR` | Tipo regulatorio. |
| `estado` | string | `ACTIVO` \| `CANCELADO` \| `SUSPENDIDO` \| `ELIMINADO` | Enum. |
| `titular` | string | `MONTE VERDE S.A.` | Titular del registro (laboratorio dueño legal). |
| `condicionesAlmacenamiento` | string | `ALMACENAR A TEMPERATURA NO MAYOR A 30°C` | Texto libre. |
| `indicacionesTerapeuticas` | string | `Tratamiento sintomático del dolor...` | Texto libre. |
| `primeraAutorizacion` | string (date) | `2003-09-10` | `YYYY-MM-DD`. Fecha alta original. |
| `anualidad` | string (date) | `2026-12-31` | `YYYY-MM-DD`. Vigencia próxima renovación. Si pasa de hoy → registro vencido. |
| `modalidadVenta` | string | `CON RECETA MEDICA` \| `SIN RECETA MEDICA` | Determina dispensación. No distingue RX controlado vs RX simple. |
| `NOMBRE_PROPIETARIO` | string | `""` (frecuente vacío) | Cuando aplica, persona/razón social distinta al titular. |
| `detalle` | string (HTML) | `<a onclick="showDetalles('F050010092003')">F050010092003</a>` | Solo presentación UI; **descartar al parsear**. |
| `pdf` | string (HTML) | 3 enlaces PDF con tokens encriptados | URLs de ficha técnica + expediente + informe. Extraer href de los `<a target="_blank">`. |

---

## 4. Esquema respuesta `/productos/infogeneral` (vista de detalle)

Estructura:

```json
{
  "status": 200,
  "data": {
    "registroSanitario": "...",
    "nombreRegistro": "...",
    "anualidad": "YYYY-MM-DD",
    "vidaUtil": "...",
    "viaAdministracion": "...",
    "categoria": "...",
    "estado": "...",
    "titular": "...",
    "condicionesAlmacenamiento": "...",
    "INDICACIONES_TERAPEUTICAS": "...",
    "MECANISMO_ACCION": "...",
    "REGIMEN_DOSIFICACION": "...",
    "FARMACOCINETICA": "...",
    "EFECTOS_ADVERSOS": "...",
    "CONTRAINDICACIONES": "...",
    "PRECAUCIONES": "...",
    "PRINCIPALES_INTERACCIONES": "...",
    "PA": [
      { "nombrePrincipioActivo": "PARACETAMOL", "nombreUnidadMedida": "MG", "concentracion": "1000" }
    ],
    "formafarm": [
      { "nombreFormaFarmaceutica": "COMPRIMIDO" }
    ],
    "fabricantes": [
      { "idFabricante": "...", "nombreFabricante": "...", "paisFabricante": "...", "tipo": "FABRICANTE", "renovacion": "YYYY-MM-DD" }
    ],
    "labsAcondi": [
      { "nombreFabricante": "...", "paisFabricante": "..." }
    ],
    "presentaciones": [
      { "codigo": "...", "nombrePresentacion": "..." }
    ]
  }
}
```

**Campos extra del detalle (no presentes en listado):**

| Campo | Uso clínico |
|---|---|
| `MECANISMO_ACCION` | Educación profesional / módulo prescripción. |
| `REGIMEN_DOSIFICACION` | Defaults de dosificación. |
| `FARMACOCINETICA` | Información de soporte. |
| `EFECTOS_ADVERSOS` | Alertas RAM (farmacovigilancia). |
| `CONTRAINDICACIONES` | Validación clínica al prescribir. |
| `PRECAUCIONES` | Alertas embarazo/lactancia/insuficiencia. |
| `PRINCIPALES_INTERACCIONES` | Motor interacciones (futuro). |
| `PA[]` | Principios activos con concentración + unidad. **Crítico** para mapeo a `Drug.genericName` + `strengthValue` + `strengthUnit`. |
| `formafarm[]` | Formas farmacéuticas (puede ser más de una si registro cubre varias). |
| `fabricantes[]` | Plantas fabricantes (no titular). País origen. |
| `labsAcondi[]` | Acondicionadores secundarios. |
| `presentaciones[]` | Cada SKU comercial (blíster x10, frasco x100ml, etc.). |

---

## 5. Mapeo SRS → modelo HIS `Drug` (Prisma actual)

Modelo destino: [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma) `model Drug` (líneas 1896-1923).

| Campo HIS (`Drug`) | Origen SRS | Transformación | Nota |
|---|---|---|---|
| `id` | — | `uuid()` HIS | No reutilizar `idProducto` SRS. |
| `genericName` | `PA[].nombrePrincipioActivo` | Si `PA.length=1` → directo. Si múltiple → concatenar con `+`. | Mantener mayúsculas SRS. |
| `brandName` | `nombreRegistro` | Extraer parte comercial (heurística). Frecuente formato `MARCA (PRINCIPIO) DOSIS FORMA TITULAR`. | Validación manual recomendada. |
| `atcCode` | **no provisto por SRS** | Resolver vía catálogo OMS interno (futuro). | Gap. |
| `pharmaceuticalForm` | `formafarm[0].nombreFormaFarmaceutica` | Mapping a enum `PharmaceuticalForm` (TABLET/CAPSULE/SYRUP/INJECTION/CREAM/OINTMENT/DROPS/INHALER/SUPPOSITORY/PATCH/OTHER). | Ver tabla §6. |
| `strengthValue` | `PA[0].concentracion` | `Decimal(12,4)`. | Si `PA.length > 1` → solo primer principio activo en este campo; los demás van a `additionalActives` (campo NUEVO sugerido). |
| `strengthUnit` | `PA[0].nombreUnidadMedida` | Normalizar: `MG` → `mg`, `ML` → `ml`, `MCG` → `mcg`, `UI` → `UI`, `%` → `%`. | |
| `dispensingClass` | `modalidadVenta` | `CON RECETA MEDICA` → `RX`<br>`SIN RECETA MEDICA` → `OTC`<br>(SRS no distingue `RX_CONTROLLED`) | `RX_CONTROLLED` se marca manualmente HIS según listado de estupefacientes/psicotrópicos JVPM. |
| `requiresControlledLog` | — | Default `false`; toggle manual para psicotrópicos. | |
| `active` | `estado` | `ACTIVO` → `true`; resto → `false`. | |
| `allergyExcipients` | **no provisto por SRS** | Parseo manual de ficha técnica PDF (futuro). | Gap. |
| `alertLevel` | — | Default `standard`; alza manual ISMP. | |
| `alertRationale` | — | Manual. | |

### Campos NUEVOS sugeridos para `Drug` (gap actual vs SRS)

| Campo nuevo | Tipo | Origen SRS | Justificación |
|---|---|---|---|
| `srsRegistroSanitario` | `VarChar(20) UNIQUE` | `registroSanitario` | **Identificador regulatorio oficial.** Trazabilidad MINSAL. Único en padrón. |
| `srsIdProducto` | `VarChar(40) UNIQUE` | `idProducto` | ID interno SRS para re-consulta del detalle. |
| `srsTitular` | `VarChar(200)` | `titular` | Titular del registro (laboratorio responsable legal). |
| `srsPrimeraAutorizacion` | `Date` | `primeraAutorizacion` | Fecha alta en registro. |
| `srsAnualidad` | `Date` | `anualidad` | Fecha vigencia próxima renovación. **Permite alerta de vencimiento.** |
| `srsCategoria` | `VarChar(60)` | `categoria` | `SÍNTESIS QUÍMICA` / `BIOLÓGICO` / etc. |
| `srsClasificacion` | `VarChar(40)` | `clasificacion` | `INNOVADOR` / `MULTIORIGEN`. |
| `srsEstado` | enum `SrsEstado` | `estado` | `ACTIVO`/`CANCELADO`/`SUSPENDIDO`/`ELIMINADO`. Más fino que `active boolean`. |
| `srsCondicionesAlmacenamiento` | `Text` | `condicionesAlmacenamiento` | Para etiquetado en bodega/farmacia. |
| `srsIndicacionesTerapeuticas` | `Text` | `indicacionesTerapeuticas` / `INDICACIONES_TERAPEUTICAS` | Soporte prescripción. |
| `srsContraindicaciones` | `Text` | `CONTRAINDICACIONES` | Validación prescripción. |
| `srsPrecauciones` | `Text` | `PRECAUCIONES` | Alertas (embarazo, lactancia, etc.). |
| `srsEfectosAdversos` | `Text` | `EFECTOS_ADVERSOS` | Farmacovigilancia. |
| `srsInteracciones` | `Text` | `PRINCIPALES_INTERACCIONES` | Base interacciones futura. |
| `srsVidaUtilMeses` | `Int` | `vidaUtil` parseado | Caducidad esperada desde fabricación (control inventario). |
| `srsViaAdministracion` | `VarChar(40)` | `viaAdministracion` | Mapeable a enum `AdminRoute` (ORAL/IV/IM/SC/TOPICAL/INHALED). |
| `srsFichaTecnicaUrl` | `Text` | extraer href del HTML `pdf` | Link directo a PDF. |
| `srsExpedienteUrl` | `Text` | extraer href del HTML `pdf` | Link directo a PDF. |
| `srsInformeEvaluacionUrl` | `Text` | extraer href del HTML `pdf` | Link directo a PDF. |
| `srsUltimaSincronizacion` | `Timestamptz` | `now()` al consultar | Trazabilidad de cache. |

### Tablas hijas sugeridas (relación 1:N con `Drug`)

| Tabla nueva | Origen SRS | Justificación |
|---|---|---|
| `DrugPrincipioActivo` | `PA[]` | Si registro tiene >1 principio activo (combinados). PK compuesta `(drugId, nombrePrincipioActivo)`. Campos: `nombrePrincipioActivo`, `concentracion Decimal`, `unidadMedida`. |
| `DrugFabricante` | `fabricantes[]` + `labsAcondi[]` | Trazabilidad fabricante/acondicionador con país origen. Campos: `idFabricanteSrs`, `nombre`, `pais`, `tipo` (FABRICANTE\|ACONDICIONADOR), `renovacion`. |
| `DrugPresentacion` | `presentaciones[]` | Cada SKU comercial (blíster/frasco/caja). Campos: `codigoPresentacion`, `nombrePresentacion`, `gtin?` (futuro GS1). Liga con `MedicationDispense.presentacionId`. |

---

## 6. Mapeo enums `PharmaceuticalForm`

Catálogo SRS observado (no exhaustivo, requiere muestreo). Mapping inicial sugerido:

| Texto SRS (`formafarm.nombreFormaFarmaceutica`) | Enum HIS `PharmaceuticalForm` |
|---|---|
| `TABLETA`, `COMPRIMIDO`, `COMPRIMIDO RECUBIERTO`, `GRAGEA` | `TABLET` |
| `CAPSULA`, `CÁPSULA`, `CAPSULA DURA`, `CAPSULA BLANDA` | `CAPSULE` |
| `JARABE`, `SUSPENSIÓN ORAL`, `SOLUCIÓN ORAL`, `EMULSIÓN ORAL` | `SYRUP` |
| `SOLUCIÓN INYECTABLE`, `POLVO PARA INYECCIÓN`, `INFUSIÓN`, `LIOFILIZADO INYECTABLE` | `INJECTION` |
| `CREMA` | `CREAM` |
| `POMADA`, `UNGÜENTO` | `OINTMENT` |
| `GOTAS ORALES`, `GOTAS OFTÁLMICAS`, `GOTAS ÓTICAS`, `GOTAS NASALES` | `DROPS` |
| `INHALADOR`, `AEROSOL INHALADOR`, `POLVO PARA INHALACIÓN` | `INHALER` |
| `SUPOSITORIO`, `ÓVULO VAGINAL` | `SUPPOSITORY` |
| `PARCHE TRANSDÉRMICO` | `PATCH` |
| cualquier otro | `OTHER` |

**Nota:** se requiere ejecutar `SELECT DISTINCT nombreFormaFarmaceutica` sobre una muestra amplia del padrón antes de cerrar el mapping. Hoy SRS no expone catálogo cerrado.

---

## 7. Estrategia de consulta sugerida (read-only, on-demand)

Arquitectura recomendada — **NO sync masivo programado**, solo cache por demanda:

```
[Farmacéutico HIS]
       ↓ busca medicamento al alta
[apps/web /admin/drugs/buscar-srs]
       ↓ consulta SRS si no existe en cache local
[packages/infrastructure/src/srs/client.ts]
       ↓ GET /productos/lista?filtro=...&busqueda=...
       ↓ GET /productos/infogeneral?param=...
       ↑ JSON normalizado
[CacheTable: SrsRegistroCache] ← persistencia local con TTL 90 días
       ↓ ofrece "Importar a catálogo Drug"
[Drug] ← creación local definitiva (firma usuario)
```

Beneficios:
- Sin dependencia operacional dura de SRS (si cae, cache local sigue funcionando).
- Sin scraping masivo (cumple "uso razonable" del portal público).
- Auditable: cada importación queda con `srsUltimaSincronizacion` y usuario que aprobó.

---

## 8. Limitaciones conocidas

1. **Sin contrato API.** Endpoints pueden cambiar. Estrategia: integration test diario que verifica `GET /productos/lista?filtro=nombre_comercial&busqueda=paracetamol` y alerta si schema cambia.
2. **Sin ATC ni CIE.** SRS no expone códigos ATC OMS ni mapeo CIE-10. Hay que resolver con catálogo paralelo (futuro fase BI).
3. **Sin GTIN/GS1.** No incluye códigos de barras de presentación. Mapeo manual o vía proveedor.
4. **PDF con tokens efímeros.** Los tokens encriptados Laravel pueden expirar; mejor regenerar al momento de mostrar al usuario, no persistir.
5. **Sin webhook de cambios.** Estado puede cambiar (`ACTIVO` → `SUSPENDIDO`) sin notificación. Mitigación: re-fetch al usar el medicamento al prescribir.
6. **Padrón solo medicamentos.** Dispositivos médicos, cosméticos e higiene tienen otros padrones SRS no cubiertos por este endpoint.
7. **Búsqueda case-insensitive aparente** pero sin documentación. Requiere validación con corpus de prueba.
8. **Sin endpoint público de descarga masiva.** Para `bulk import` inicial habría que solicitar formalmente al SRS (correo `[email protected]`).

---

## 9. Próximos pasos sugeridos (esperando confirmación del usuario)

1. **Migración schema** — agregar 20 columnas `srs*` a `Drug` + 3 tablas hijas (`DrugPrincipioActivo`, `DrugFabricante`, `DrugPresentacion`).
2. **Cliente TS** — `packages/infrastructure/src/srs/client.ts` con `searchByNombreComercial(q, estado)`, `searchByPrincipioActivo(q)`, `getDetalleByRegistro(reg)`. Zero-dependency (fetch nativo).
3. **Router tRPC** — `srsRegistroSanitario.router.ts` con `buscar`, `detalle`, `importarADrug` (rol PHARMACIST + ADMIN).
4. **UI buscador** — `/admin/drugs/buscar-srs` con tabla resultados + modal detalle + botón "Importar".
5. **Job opcional** — re-validar estado de `Drug` con `srsRegistroSanitario` cada N días (alerta si pasó a `SUSPENDIDO`/`CANCELADO`/`ELIMINADO`).
6. **Tabla cache** — `SrsRegistroCache` para amortiguar caída de SRS.

Ninguno de estos pasos se ejecuta hasta confirmación explícita.
