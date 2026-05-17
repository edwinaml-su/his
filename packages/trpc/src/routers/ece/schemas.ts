/**
 * Re-exporta los schemas de consentimiento informado desde @his/contracts.
 *
 * Este archivo actúa como adaptador local mientras el worktree no tiene
 * el symlink @his/contracts apuntando a sí mismo. En el branch main,
 * el router importa directamente desde @his/contracts.
 *
 * Ver: packages/contracts/src/schemas/ece-consentimiento.ts (fuente canónica).
 */
import { z } from "zod";

export const tipoConsentimientoSchema = z.enum([
  "hospitalizacion",
  "quirurgico",
  "anestesico",
  "otro",
]);

export const eceConsentimientoCreateSchema = z.object({
  episodioId: z.string().uuid(),
  tipoConsentimiento: tipoConsentimientoSchema,
  procedimientoDescrito: z.string().min(1).max(4000),
  riesgos: z.string().max(4000).optional(),
  alternativas: z.string().max(4000).optional(),
  datosTestigo: z
    .object({
      nombre: z.string().min(1).max(200),
      documento: z.string().min(1).max(50),
    })
    .optional(),
});

export const eceConsentimientoFirmarPacienteSchema = z.object({
  consentimientoId: z.string().uuid(),
  firmanteTipo: z.enum(["paciente", "representante_legal"]),
  firmanteNombre: z.string().min(1).max(200),
  firmanteDocumento: z.string().min(1).max(50),
  firmaImagenUri: z.string().url().max(1000),
});

export const eceConsentimientoFirmarMcSchema = z.object({
  consentimientoId: z.string().uuid(),
  pin: z.string().trim().regex(/^\d{6,8}$/, "PIN debe ser 6-8 dígitos"),
  contexto: z.string().max(500).optional(),
});

export const eceConsentimientoValidarSchema = z.object({
  consentimientoId: z.string().uuid(),
  observacion: z.string().max(1000).optional(),
});
