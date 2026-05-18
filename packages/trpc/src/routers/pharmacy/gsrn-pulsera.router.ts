/**
 * US.F2.6.1 — GSRN Pulsera Paciente.
 *
 * Procedimientos expuestos:
 *   gsrnPulsera.assign     — asigna GSRN único al confirmar admisión hospitalaria
 *   gsrnPulsera.get        — consulta GSRN actual del paciente
 *   gsrnPulsera.print      — genera payload de impresión (ZPL stub + DataMatrix base64)
 *   gsrnPulsera.reprint    — reimprime sin reasignar GSRN
 *
 * Algoritmo GSRN: AI(8018) + prefijo empresa GS1 (7–9 dígitos de org.gs1CompanyPrefix)
 * + serial paciente (derivado de mrn) + dígito verificador módulo-10 GS1.
 *
 * Si la organización no tiene gs1CompanyPrefix se usa un prefijo de fallback
 * ("7503000") para no bloquear el flujo — el operador debe completar la config.
 *
 * Restricciones:
 *   - Hard Stop si el paciente ya tiene GSRN (duplicate check vía unique constraint).
 *   - Toda escritura usa withTenantContext.
 *   - La impresión es un stub; Wave 2 integrará CUPS/IPP real.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildGSRN, validateGSRN } from "@his/contracts";
import { router, tenantProcedure } from "../../trpc";
import { withTenantContext } from "../../rls-context";

// Prefijo GS1 de fallback cuando la org no tiene uno configurado.
const FALLBACK_GS1_PREFIX = "7503000";

/**
 * Extrae el número serial de un MRN tipo "MRN-NNNN" o devuelve el hash numérico
 * del string completo si el formato no coincide.
 */
function serialFromMrn(mrn: string): number {
  const match = /(\d+)$/.exec(mrn);
  if (match) {
    return Number.parseInt(match[1]!, 10);
  }
  // Fallback: suma de char codes para MRNs no estándar.
  return Array.from(mrn).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 1_000_000;
}

/**
 * Genera el stub de impresión de pulsera.
 *
 * Devuelve:
 *   zpl  — string ZPL II para impresoras Zebra
 *   dataMatrixB64 — PNG base64 de DataMatrix (stub SVG → bwip-js Wave 2)
 *
 * Wave 2: integrar `bwip-js` para DataMatrix real y envío a GLN de impresora.
 */
function buildPulseraPayload(
  gsrn: string,
  patientName: string,
  mrn: string,
): { zpl: string; dataMatrixB64: string } {
  // ZPL II stub — produce etiqueta 4"×1" con Code 128 + GSRN + nombre.
  const zpl = [
    "^XA",
    "^FO50,30^BY2^BCN,60,Y,N,N^FD" + gsrn + "^FS",
    "^FO50,100^A0N,20,20^FD" + patientName + "^FS",
    "^FO50,125^A0N,16,16^FDMRN: " + mrn + "^FS",
    "^FO50,145^A0N,14,14^FDGSRN: " + gsrn + "^FS",
    "^XZ",
  ].join("\n");

  // DataMatrix stub: SVG mínimo en base64.
  // Wave 2: sustituir con bwip-js.render('datamatrix', { text: gsrn }).
  const svgStub = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#fff"/><text x="4" y="20" font-size="8">GSRN</text><text x="4" y="36" font-size="6">${gsrn.slice(0, 9)}</text><text x="4" y="50" font-size="6">${gsrn.slice(9)}</text></svg>`;
  const dataMatrixB64 = Buffer.from(svgStub).toString("base64");

  return { zpl, dataMatrixB64 };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const gsrnPulseraRouter = router({
  /**
   * Asigna GSRN al paciente. Hard Stop si ya tiene uno asignado.
   * Diseñado para llamarse desde el encounter.admit hook al crear admisión
   * de tipo SCHEDULED/EMERGENCY (hospitalización).
   */
  assign: tenantProcedure
    .input(z.object({ patientId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const patient = await tx.patient.findFirst({
          where: {
            id: input.patientId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, gsrn: true, mrn: true },
        });

        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Paciente no encontrado.",
          });
        }

        if (patient.gsrn) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El paciente ya tiene GSRN asignado: ${patient.gsrn}`,
          });
        }

        const org = await tx.organization.findUnique({
          where: { id: ctx.tenant.organizationId },
          select: { gs1CompanyPrefix: true },
        });

        const prefix = org?.gs1CompanyPrefix ?? FALLBACK_GS1_PREFIX;
        const serial = serialFromMrn(patient.mrn);
        const gsrn = buildGSRN(prefix, serial);

        // Validar antes de persistir (defensivo — buildGSRN ya garantiza).
        if (!validateGSRN(gsrn)) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "GSRN generado no pasó validación módulo-10.",
          });
        }

        const updated = await tx.patient.update({
          where: { id: patient.id },
          data: { gsrn },
          select: { id: true, gsrn: true },
        });

        return { patientId: updated.id, gsrn: updated.gsrn! };
      });
    }),

  /** Consulta el GSRN actual sin modificarlo. */
  get: tenantProcedure
    .input(z.object({ patientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const patient = await tx.patient.findFirst({
          where: {
            id: input.patientId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: { id: true, gsrn: true },
        });

        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Paciente no encontrado.",
          });
        }

        return { patientId: patient.id, gsrn: patient.gsrn ?? null };
      });
    }),

  /**
   * Genera el payload de impresión (ZPL + DataMatrix).
   * No asigna ni modifica el GSRN — solo lo usa para construir la etiqueta.
   * Hard Stop si el paciente no tiene GSRN.
   */
  print: tenantProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        /** GLN de la impresora destino. Wave 2: ruteo real. Ignorado en stub. */
        glnPrinter: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const patient = await tx.patient.findFirst({
          where: {
            id: input.patientId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: {
            id: true,
            gsrn: true,
            mrn: true,
            firstName: true,
            lastName: true,
          },
        });

        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Paciente no encontrado.",
          });
        }

        if (!patient.gsrn) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "El paciente no tiene GSRN asignado. Confirme la admisión primero.",
          });
        }

        const patientName = `${patient.firstName} ${patient.lastName}`;
        const payload = buildPulseraPayload(patient.gsrn, patientName, patient.mrn);

        return {
          gsrn: patient.gsrn,
          patientName,
          mrn: patient.mrn,
          zpl: payload.zpl,
          dataMatrixB64: payload.dataMatrixB64,
          /** Wave 2: enlace al PDF renderizado por servicio de impresión. */
          pdfUrl: null as string | null,
          printedAt: new Date().toISOString(),
        };
      });
    }),

  /**
   * Reimprime la pulsera sin reasignar GSRN.
   * Wrapper semántico sobre print — el GSRN no cambia.
   */
  reprint: tenantProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        glnPrinter: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Reutiliza exactamente la lógica de print (no reasigna).
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const patient = await tx.patient.findFirst({
          where: {
            id: input.patientId,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
          select: {
            id: true,
            gsrn: true,
            mrn: true,
            firstName: true,
            lastName: true,
          },
        });

        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Paciente no encontrado.",
          });
        }

        if (!patient.gsrn) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "El paciente no tiene GSRN asignado. No hay pulsera que reimprimir.",
          });
        }

        const patientName = `${patient.firstName} ${patient.lastName}`;
        const payload = buildPulseraPayload(patient.gsrn, patientName, patient.mrn);

        return {
          gsrn: patient.gsrn,
          patientName,
          mrn: patient.mrn,
          zpl: payload.zpl,
          dataMatrixB64: payload.dataMatrixB64,
          pdfUrl: null as string | null,
          reprintedAt: new Date().toISOString(),
        };
      });
    }),
});
