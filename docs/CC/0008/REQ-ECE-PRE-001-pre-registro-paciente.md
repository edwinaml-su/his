# REQ-ECE-PRE-001 — Pantalla "Pre-registro" de paciente

| | |
|---|---|
| **Producto** | HIS Multipaís — Complejo Avante |
| **Módulo** | ECE / Pacientes |
| **Ruta** | `/patients/new` |
| **Stack** | Next.js (App Router) · tRPC · Prisma · Supabase/PostgreSQL · Vercel |
| **Design System** | v2.0 — navy `#0B3D5C` / teal `#00A8B5` |
| **Tipo** | Brief de implementación para Claude Code |
| **Referencia visual** | `preregistro.html` (mockup adjunto, fuente de verdad del diseño) |
| **Estado** | Listo para desarrollo |

> **Para Claude Code:** este documento es el prompt de trabajo. Ejecuta las tareas de §13 en orden, respetando la skill `careful-coding` (cambios quirúrgicos, simplicidad, verificación por objetivo). No agregues alcance no solicitado. Adjunta `preregistro.html` como referencia de layout y tokens.

---

## 1. Objetivo

Rediseñar la pantalla de alta inicial de paciente, renombrada de **"Nuevo paciente"** a **"Pre-registro"**, con captura asistida por escaneo de documento, jerarquía de campos clínica, identificación basada en documento y **edad derivada**. El resultado debe coincidir con la referencia visual y cumplir los criterios de aceptación de §10.

## 2. Alcance

**Incluye:** UI de la pantalla, controles y validación, esquema de datos del paciente, lógica condicional del documento, contrato del lector de documento + simulación de autocompletado, utilidad de edad con pruebas, y el cambio de navegación en el menú.

**No incluye:** integración real del hardware/SDK de escaneo (se entrega el contrato del parser + simulación con datos de muestra), flujos de admisión posteriores, integración CIE-11, ni módulos clínicos. El número de expediente ya se genera en servidor con la lógica existente (no se reimplementa aquí).

## 3. Contexto del dominio

- El **expediente es inmutable**; su número se genera en servidor con el formato existente (`código país + año de nacimiento + correlativo`). `fechaNacimiento` alimenta el componente de año, por lo que es un dato crítico de este formulario.
- Identificación **basada en documento**: el paciente se identifica por `(tipoDocumento, numeroDocumento)`.
- Multipaís: el código de país proviene del contexto organizacional activo (p. ej. Avante Holding → SV); no se captura en este formulario.

## 4. Catálogo de requerimientos

| # | Requerimiento | Detalle |
|---|---|---|
| R1 | Renombrar pantalla | "Nuevo paciente" → **"Pre-registro"** en H1, breadcrumb y `<title>`. |
| R2 | Ítem de menú | Agregar **"Pre-registro"** (con guion) en sección **CLÍNICO**, activo en esta ruta. "Pacientes" permanece como ítem aparte. |
| R3 | Eliminar MRN | Quitar por completo el campo y la etiqueta **MRN**. |
| R4 | Orden | **"Tipo de documento" va primero**, antes de los nombres. |
| R5 | Tipo de documento como radio | Reemplazar la lista desplegable por **radio buttons**. Opciones: **DUI · Pasaporte · Carnet de Residente** (se elimina DNI; se incorpora Carnet de Residente). |
| R6 | Switch "¿Trae documento?" | Checkbox/switch **"El paciente trae documento de identidad"** que gobierna el bloque de documento (ver §6). |
| R7 | Autocompletado por escaneo | Al escanear **QR / código de barras** de DUI, Pasaporte o Carnet de Residente, se llena el formulario (ver §7). |
| R8 | Fecha desde documento | **Fecha de nacimiento** obtenida del documento al escanear. |
| R9 | Nombres y apellidos | Hasta **3 nombres** (primer, segundo, tercer) y **3 apellidos**: primer apellido, segundo apellido y **apellido de casada cuando aplique**. |
| R10 | Sexo biológico como radio | **Radio buttons** (Masculino, Femenino), no lista desplegable. |
| R11 | Etiqueta | "Número de DUI" → **"Número de Documento"**. |
| R12 | Obligatoriedad | Campos obligatorios según §5/§6 (estructurales requeridos; slots adicionales de nombre opcionales). |
| R13 | Edad calculada | **Edad** derivada de `fechaNacimiento` y la fecha actual; campo **no editable y no persistido** (ver §8). |

## 5. Especificación de campos

| id | Etiqueta | Control | Obligatorio | Origen | Validación |
|---|---|---|---|---|---|
| `traeDocumento` | El paciente trae documento de identidad | switch | Sí (default **ON**) | Usuario | boolean |
| `tipoDocumento` | Tipo de documento `*` | radio (DUI / Pasaporte / Carnet de Residente) | Sí, si `traeDocumento` | Escaneo · Usuario | enum |
| `numeroDocumento` | Número de Documento `*` | text | Sí, si `traeDocumento` | Escaneo · Usuario | formato por tipo (§7) |
| — | Escanear documento (QR / código de barras) | button | — | — | — |
| `primerNombre` | Primer nombre `*` | text | **Sí** | Escaneo · Usuario | `min 1` |
| `segundoNombre` | Segundo nombre | text | No | Escaneo · Usuario | — |
| `tercerNombre` | Tercer nombre | text | No | Usuario | — |
| `primerApellido` | Primer apellido `*` | text | **Sí** | Escaneo · Usuario | `min 1` |
| `segundoApellido` | Segundo apellido | text | No | Escaneo · Usuario | — |
| `apellidoCasada` | Apellido de casada (si aplica) | text | No | Escaneo · Usuario | — |
| `sexoBiologico` | Sexo biológico `*` | radio (Masculino / Femenino) | **Sí** | Escaneo · Usuario | enum |
| `fechaNacimiento` | Fecha de nacimiento `*` | date | **Sí** | Escaneo · Usuario | `≤ hoy` (no futura) |
| `edad` | Edad | display **derivado** | — | Calculado | no editable · **no persistido** |

`*` = obligatorio.

## 6. Lógica condicional — "¿Trae documento?"

`traeDocumento` (default **ON**) gobierna el formulario:

- **ON** → se muestran `tipoDocumento`, `numeroDocumento` y el botón de escaneo. `tipoDocumento` y `numeroDocumento` son **obligatorios**. Los datos demográficos pueden llegar por escaneo o captura manual.
- **OFF** → se ocultan los campos de documento y **dejan de ser obligatorios** (`tipoDocumento`/`numeroDocumento` quedan en `null`). Se muestra el aviso *"Captura manual — el paciente no presenta documento."* Los datos demográficos siguen siendo obligatorios y se ingresan a mano.

> Los campos **siempre obligatorios** son: `primerNombre`, `primerApellido`, `sexoBiologico`, `fechaNacimiento`. Esto resuelve la tensión "todos obligatorios" vs. "hasta tres nombres / cuando aplique": lo estructural es requerido; los slots adicionales de nombre/apellido son opcionales por naturaleza.

## 7. Escaneo y autocompletado

El botón de escaneo lee el portador de datos del documento (DUI → PDF417 al reverso; Pasaporte → MRZ ICAO 9303; Carnet de Residente → portador DGME) y entrega un objeto normalizado que mapea 1:1 a los campos del formulario.

**Contrato del parser:**

```ts
export interface DatosDocumento {
  tipoDocumento: 'DUI' | 'PASAPORTE' | 'CARNET_RESIDENTE';
  numeroDocumento: string;
  primerNombre: string;
  segundoNombre?: string;
  tercerNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  apellidoCasada?: string;
  sexoBiologico: 'MASCULINO' | 'FEMENINO';
  fechaNacimiento: string; // ISO yyyy-mm-dd
}

// En producción: integrar el SDK del lector. En el mockup: devolver muestra fija.
export function parseDocumento(raw: string, tipo: TipoDocumento): DatosDocumento { /* ... */ }
```

**Comportamiento UI:**
- Al escanear, los campos poblados se marcan como **capturados** (resaltado teal) y muestran el aviso *"Datos obtenidos del documento. Verifique antes de continuar."*
- Los campos capturados quedan **editables** (verificables por el operador).
- Tras poblar `fechaNacimiento`, se recalcula la edad (§8) automáticamente.

**Validación de `numeroDocumento` por tipo:**
- **DUI**: `^\d{8}-\d$` (8 dígitos + dígito verificador, p. ej. `04829175-3`).
- **Pasaporte**: alfanumérico, `^[A-Z0-9]{6,9}$` (permisivo; varía por país).
- **Carnet de Residente**: validación permisiva — **confirmar formato oficial DGME** (ver §14).

## 8. Edad derivada

Campo calculado en lectura, **nunca persistido**. Regla de presentación:
- `≥ 1 año` → `"{n} año(s)"`
- `< 1 año, ≥ 1 mes` → `"{n} mes(es)"`
- `< 1 mes` → `"{n} día(s)"`

**Utilidad (pura, testeable):**

```ts
// lib/edad.ts
export type Edad = { anios: number; meses: number; dias: number; label: string };

export function calcularEdad(nacimiento: Date, ahora: Date = new Date()): Edad {
  let anios = ahora.getFullYear() - nacimiento.getFullYear();
  let meses = ahora.getMonth()    - nacimiento.getMonth();
  let dias  = ahora.getDate()     - nacimiento.getDate();
  if (dias < 0)  { meses--; dias += new Date(ahora.getFullYear(), ahora.getMonth(), 0).getDate(); }
  if (meses < 0) { anios--; meses += 12; }

  const label =
    anios >= 1 ? `${anios} ${anios === 1 ? 'año' : 'años'}` :
    meses >= 1 ? `${meses} ${meses === 1 ? 'mes' : 'meses'}` :
                 `${dias} ${dias === 1 ? 'día' : 'días'}`;

  return { anios, meses, dias, label };
}
```

**Pruebas (referencia: hoy = 2026-06-26):**

```ts
// lib/edad.test.ts
const hoy = new Date('2026-06-26T00:00:00');
expect(calcularEdad(new Date('1990-07-14'), hoy).label).toBe('35 años'); // cumpleaños aún no alcanzado
expect(calcularEdad(new Date('1990-06-01'), hoy).label).toBe('36 años');
expect(calcularEdad(new Date('2026-05-01'), hoy).label).toBe('1 mes');   // lactante
expect(calcularEdad(new Date('2026-06-20'), hoy).label).toBe('6 días');  // recién nacido
```

Recalcular en: (a) cambio de `fechaNacimiento` por el usuario, (b) autocompletado por escaneo.

## 9. Modelo de datos y persistencia

**Prisma:**

```prisma
enum TipoDocumento {
  DUI
  PASAPORTE
  CARNET_RESIDENTE
}

enum SexoBiologico {
  MASCULINO
  FEMENINO
}

model Paciente {
  id               String         @id @default(cuid())
  numeroExpediente String         @unique          // generado en servidor, inmutable
  traeDocumento    Boolean        @default(true)
  tipoDocumento    TipoDocumento?
  numeroDocumento  String?
  primerNombre     String
  segundoNombre    String?
  tercerNombre     String?
  primerApellido   String
  segundoApellido  String?
  apellidoCasada   String?
  sexoBiologico    SexoBiologico
  fechaNacimiento  DateTime       @db.Date
  createdAt        DateTime       @default(now())
  // edad: NO se persiste — se calcula en lectura con lib/edad.ts
}
```

**Unicidad de documento (índice parcial):** la unicidad debe aplicarse solo cuando hay documento, para no colisionar entre pacientes sin documento. Crear vía migración:

```sql
CREATE UNIQUE INDEX uq_paciente_documento
  ON "Paciente" ("tipoDocumento", "numeroDocumento")
  WHERE "numeroDocumento" IS NOT NULL;
```

**Validación tRPC (zod):**

```ts
const preRegistroSchema = z.object({
  traeDocumento: z.boolean(),
  tipoDocumento: z.enum(['DUI', 'PASAPORTE', 'CARNET_RESIDENTE']).optional(),
  numeroDocumento: z.string().trim().optional(),
  primerNombre: z.string().trim().min(1),
  segundoNombre: z.string().trim().optional(),
  tercerNombre: z.string().trim().optional(),
  primerApellido: z.string().trim().min(1),
  segundoApellido: z.string().trim().optional(),
  apellidoCasada: z.string().trim().optional(),
  sexoBiologico: z.enum(['MASCULINO', 'FEMENINO']),
  fechaNacimiento: z.coerce.date().max(new Date(), { message: 'La fecha no puede ser futura' }),
}).superRefine((d, ctx) => {
  if (d.traeDocumento) {
    if (!d.tipoDocumento)
      ctx.addIssue({ code: 'custom', path: ['tipoDocumento'], message: 'Requerido cuando el paciente trae documento' });
    if (!d.numeroDocumento)
      ctx.addIssue({ code: 'custom', path: ['numeroDocumento'], message: 'Requerido cuando el paciente trae documento' });
    if (d.tipoDocumento === 'DUI' && d.numeroDocumento && !/^\d{8}-\d$/.test(d.numeroDocumento))
      ctx.addIssue({ code: 'custom', path: ['numeroDocumento'], message: 'Formato DUI inválido (########-#)' });
  }
});
```

`numeroExpediente` se genera en el `mutation` de creación con la lógica existente; **no** viene del cliente.

## 10. Criterios de aceptación

- [ ] **AC1** — El título de la pantalla y el ítem de menú dicen **"Pre-registro"** (con guion). No existe ningún campo MRN.
- [ ] **AC2** — "Tipo de documento" se renderiza **antes** de los nombres, como **radio buttons** con exactamente: DUI, Pasaporte, Carnet de Residente.
- [ ] **AC3** — "Sexo biológico" se renderiza como **radio buttons** (Masculino, Femenino).
- [ ] **AC4** — La etiqueta del número es **"Número de Documento"** (no "Número de DUI").
- [ ] **AC5** — El switch "¿Trae documento?" alterna el bloque de documento; en **OFF** los campos de documento se ocultan y no se exigen, se muestra el aviso de captura manual, y los demográficos siguen obligatorios.
- [ ] **AC6** — "Escanear documento" puebla número, nombres, apellidos, sexo y fecha de nacimiento, y los marca como capturados.
- [ ] **AC7** — La **Edad** se actualiza sola desde `fechaNacimiento` contra la fecha actual, mostrando años / meses / días correctamente (incluye cumpleaños no alcanzado y lactantes). Las pruebas de §8 pasan.
- [ ] **AC8** — `primerNombre` y `primerApellido` obligatorios; segundo/tercer nombre, segundo apellido y apellido de casada opcionales.
- [ ] **AC9** — `fechaNacimiento` no admite fechas futuras.
- [ ] **AC10** — Al guardar, se crea el paciente con `numeroExpediente` inmutable generado en servidor; **la edad no se persiste**.

## 11. Cambio de navegación (menú)

- En la sección **CLÍNICO** de la barra lateral, agregar el ítem **"Pre-registro"** con ícono de "usuario +" (user-plus).
- Marcarlo **activo** en la ruta `/patients/new`.
- Conservar **"Pacientes"** como ítem independiente (lista/registro de pacientes).
- Aplicar el mismo "Pre-registro" en el breadcrumb (`Patients › Pre-registro`).

## 12. Tokens de diseño (DS v2.0)

| Token | Valor | Uso |
|---|---|---|
| `--navy` | `#0B3D5C` | Sidebar, botón primario, títulos |
| `--teal` | `#00A8B5` | Botón de escaneo, foco, resaltado de campos capturados/derivados |
| `--blue-active` | `#1C6CE0` | Ítem de menú activo |
| `--required` | `#DC2626` | Asterisco de obligatorio |
| Tipografía | Inter | UI |
| Radio de borde | `8px` | Inputs, chips, tarjetas |

## 13. Plan de tareas para Claude Code

> Ejecutar en orden. Cada paso indica su verificación (skill `careful-coding`).

1. **Renombrar y limpiar** la página `/patients/new`: "Nuevo paciente" → "Pre-registro" en H1, breadcrumb y `<title>`; eliminar el campo MRN. → *Verificar:* título correcto y ausencia total de MRN.
2. **Reordenar y convertir controles**: "Tipo de documento" antes de los nombres; `tipoDocumento` y `sexoBiologico` como radio buttons. → *Verificar:* orden de render y controles tipo radio.
3. **Enum de documento**: en Prisma, tRPC y UI eliminar `DNI` e incorporar `CARNET_RESIDENTE`; generar migración. → *Verificar:* migración aplicada y opciones correctas (DUI, Pasaporte, Carnet de Residente).
4. **Switch "¿Trae documento?"** con render y validación condicional (§6) en UI y en el `superRefine` de zod. → *Verificar:* OFF oculta documento, no lo exige, muestra aviso manual; ON lo exige.
5. **Nombres y apellidos**: campos hasta 3 nombres y 3 apellidos (incluye apellido de casada) en esquema y UI. → *Verificar:* esquema y formulario.
6. **Etiqueta** "Número de DUI" → "Número de Documento". → *Verificar:* texto en pantalla.
7. **Utilidad de edad** `lib/edad.ts` + `lib/edad.test.ts` (§8); enlazar el display de edad a `fechaNacimiento` y al escaneo. → *Verificar:* `npm test` de edad en verde y actualización en vivo.
8. **Contrato del parser** `parseDocumento` + autocompletado simulado con muestra fija; marcar campos capturados. → *Verificar:* el escaneo mapea todos los campos y recalcula la edad.
9. **Navegación** (§11): agregar ítem "Pre-registro" en CLÍNICO, activo en la ruta. → *Verificar:* estado activo correcto.
10. **Validación final** (zod, §9) y aplicación de tokens (§12). → *Verificar:* entradas inválidas rechazadas; AC1–AC10 cumplidos.

## 14. Supuestos y decisiones abiertas

1. **"Todos obligatorios"** se interpreta como: estructurales requeridos; slots adicionales de nombre/apellido opcionales. *(Confirmar.)*
2. **Sexo biológico**: solo Masculino/Femenino. *(¿Se requiere "Indeterminado / No especificado" para casos clínicos como recién nacidos con sexo ambiguo?)*
3. **Formatos de documento**: DUI confirmado (`########-#`). Pasaporte y **Carnet de Residente requieren confirmación del formato oficial (DGME)** antes de endurecer la validación.
4. **Menores sin documento propio**: ¿cómo maneja el pre-registro a un paciente menor identificado por el documento de un responsable (`DUI_RESP` del modelo existente)? Definir la relación con el identificador de expediente.
5. **Detección de duplicados**: ¿verificar expediente existente por `(tipoDocumento, numeroDocumento)` antes de crear, para evitar duplicados?
6. **Hardware/SDK de escaneo**: definir el lector y SDK (PDF417 / MRZ / DGME). Fuera de alcance del mockup; se entrega solo el contrato `parseDocumento`.
