/**
 * Schemas Zod para Acto Quirúrgico ECE (NTEC §3.13 / Doc 13).
 *
 * Fuente canónica: packages/contracts/src/schemas/ece-acto-quirurgico.ts
 * Adaptador local para el worktree (sin symlink @his/contracts).
 */
import { z } from "zod";

export const estadoActoQxSchema = z.enum([
  "borrador",
  "firmado",
  "validado",
  "anulado",
]);
export type EstadoActoQx = z.infer<typeof estadoActoQxSchema>;

/**
 * Ayudante del equipo quirúrgico (instrumentista, primer ayudante, etc.)
 * Se almacena en ece.acto_quirurgico.ayudantes JSONB.
 */
export const ayudanteSchema = z.object({
  personalId: z.string().uuid(),
  rol: z.enum([
    "primer_ayudante",
    "segundo_ayudante",
    "instrumentista",
    "circulante",
    "otro",
  ]),
});
export type Ayudante = z.infer<typeof ayudanteSchema>;

// ─── List ─────────────────────────────────────────────────────────────────────

export const actoQxListSchema = z.object({
  episodioId: z.string().uuid().optional(),
  cirujanoId: z.string().uuid().optional(),
  estado: estadoActoQxSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// ─── Get ──────────────────────────────────────────────────────────────────────

export const actoQxGetSchema = z.object({ id: z.string().uuid() });

// ─── Create ───────────────────────────────────────────────────────────────────

export const actoQxCreateSchema = z.object({
  episodioId: z.string().uuid(),
  /** Paso 1 — Equipo */
  cirujanoId: z.string().uuid(),
  anestesiologoId: z.string().uuid().optional(),
  ayudantes: z.array(ayudanteSchema).max(10).default([]),
  /** Paso 2 — Preoperatorio */
  diagnosticoPre: z.string().trim().min(1).max(2000),
  valoracionPreop: z
    .object({
      asaClase: z.enum(["I", "II", "III", "IV", "V", "VI"]).optional(),
      ayunoHoras: z.number().int().min(0).max(48).optional(),
      alergiasRelevantes: z.string().max(1000).optional(),
    })
    .optional(),
  checklistCirugiaSeguradEntrada: z.record(z.boolean()).optional(),
  /** Paso 3 — Técnica */
  procedimientoRealizado: z.string().trim().min(1).max(4000),
  hallazgos: z.string().trim().max(4000).optional(),
  tecnica: z.string().trim().max(4000).optional(),
  complicaciones: z.string().trim().max(2000).optional(),
  sangradoEstimadoMl: z.number().int().min(0).optional(),
  muestrasEnviadas: z.string().trim().max(1000).optional(),
  tiempoQuirurgicoMin: z.number().int().min(1).optional(),
  horaInicio: z.coerce.date().optional(),
  horaFin: z.coerce.date().optional(),
  /** Paso 4 — Postoperatorio */
  diagnosticoPost: z.string().trim().max(2000).optional(),
  registroAnestesico: z.any().optional(),
  recuperacionUrpa: z.any().optional(),
});

// ─── Update (parcial — solo en borrador) ─────────────────────────────────────

export const actoQxUpdateSchema = z.object({
  id: z.string().uuid(),
  diagnosticoPre: z.string().trim().min(1).max(2000).optional(),
  diagnosticoPost: z.string().trim().max(2000).optional(),
  procedimientoRealizado: z.string().trim().min(1).max(4000).optional(),
  hallazgos: z.string().trim().max(4000).optional(),
  tecnica: z.string().trim().max(4000).optional(),
  complicaciones: z.string().trim().max(2000).optional(),
  sangradoEstimadoMl: z.number().int().min(0).optional(),
  muestrasEnviadas: z.string().trim().max(1000).optional(),
  tiempoQuirurgicoMin: z.number().int().min(1).optional(),
  horaInicio: z.coerce.date().optional(),
  horaFin: z.coerce.date().optional(),
  ayudantes: z.array(ayudanteSchema).max(10).optional(),
  valoracionPreop: z.any().optional(),
  registroAnestesico: z.any().optional(),
  recuperacionUrpa: z.any().optional(),
});

// ─── Firmar (ESP cirujano) ────────────────────────────────────────────────────

export const actoQxFirmarSchema = z.object({
  id: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
  checklistSalidaConfirmado: z.boolean().default(false),
});

// ─── Validar (ESP jefe de servicio / DIR) ────────────────────────────────────

export const actoQxValidarSchema = z.object({
  id: z.string().uuid(),
  observacion: z.string().max(1000).optional(),
});

// ─── Anular ───────────────────────────────────────────────────────────────────

export const actoQxAnularSchema = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(1).max(1000),
});
