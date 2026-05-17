/**
 * Contratos Zod — Bridge Admisión Hospitalaria (Fase 2).
 *
 * Cubre:
 *   admitirDesdeOrden         — tx atómica: episodio + episodio_hosp + hoja_ingreso + (cama).
 *   listOrdenesPendientesAdmision — órdenes validadas sin episodio (cola ADM).
 *
 * Invariantes:
 *   - La orden debe estar en estado "validado" (firmado MT + validado MC).
 *   - Si la orden ya tiene episodio → CONFLICT (idempotencia por diseño).
 *   - camaId es opcional; si se omite, la cama se asigna manualmente luego.
 *
 * Roles permitidos:
 *   - admitirDesdeOrden  : requireRole(["ADM"])
 *   - listOrdenesPendientes: tenantProcedure (lectura; roles ADM/PHYSICIAN)
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// admitirDesdeOrden — input
// ---------------------------------------------------------------------------

export const admitirDesdeOrdenInput = z.object({
  /** UUID de ece.orden_ingreso validada (firmada MT + validada MC). */
  ordenIngresoId: z.string().uuid(),
  /** Fecha/hora efectiva de ingreso hospitalario (Art. 17 NTEC). */
  fechaHoraIngreso: z.string().datetime({ offset: true }),
  /** UUID de ece.cama a asignar. Omitir si se asigna manualmente luego. */
  camaId: z.string().uuid().optional(),
  /**
   * Modalidad hospitalaria (internamiento, hospital_dia, etc.).
   * Corresponde a EceEpisodioHospitalario.modalidadHospitalaria.
   */
  modalidad: z.string().min(1).max(30),
  /**
   * Procedencia de ingreso (domicilio, emergencia, traslado, etc.).
   * Corresponde a EceEpisodioHospitalario.procedenciaIngreso.
   */
  procedencia: z.string().min(1).max(40),
  /**
   * PIN/credencial de firma electrónica del ADM que ejecuta la admisión.
   * Se valida contra ece.firma_electronica del personal en sesión.
   */
  pinAdm: z.string().min(4).max(20),
});

export type AdmitirDesdeOrdenInput = z.infer<typeof admitirDesdeOrdenInput>;

// ---------------------------------------------------------------------------
// admitirDesdeOrden — output
// ---------------------------------------------------------------------------

export const admitirDesdeOrdenOutput = z.object({
  episodioId: z.string().uuid(),
  episodioHospitalarioId: z.string().uuid(),
  hojaIngresoId: z.string().uuid(),
  camaAsignadaId: z.string().uuid().nullable(),
});

export type AdmitirDesdeOrdenOutput = z.infer<typeof admitirDesdeOrdenOutput>;

// ---------------------------------------------------------------------------
// listOrdenesPendientesAdmision — input / output shapes
// ---------------------------------------------------------------------------

export const listOrdenesPendientesAdmisionInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  /** Filtrar por servicio de destino (servicioIngresoId). */
  servicioId: z.string().uuid().optional(),
});

export type ListOrdenesPendientesAdmisionInput = z.infer<
  typeof listOrdenesPendientesAdmisionInput
>;

export const ordenPendienteAdmisionShape = z.object({
  id: z.string().uuid(),
  pacienteId: z.string().uuid(),
  pacienteNombre: z.string(),
  servicioNombre: z.string().nullable(),
  modalidad: z.string(),
  procedencia: z.string(),
  circunstanciaIngreso: z.string(),
  fechaHoraOrden: z.string(),
  medicoOrdenaId: z.string().uuid(),
  registradoEn: z.string(),
});

export type OrdenPendienteAdmision = z.infer<typeof ordenPendienteAdmisionShape>;
