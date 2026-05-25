"use server";

/**
 * Server action — envío de reporte de KPIs por correo.
 *
 * Implementación actual: registra el envío en la bitácora ECE (audit_log
 * cuando exista; por ahora console.log + retorno OK simulado). Para envío
 * real necesita integración con proveedor SMTP / Resend / SendGrid; cuando
 * esté disponible solo hay que reemplazar el cuerpo de esta función.
 */
import { getCurrentUser } from "@/lib/auth/session";

interface KpiRow {
  categoria: string;
  titulo: string;
  valor: string;
  meta: string;
}

export interface SendKpiReportInput {
  recipient: string;
  fechaDesde: string;
  fechaHasta: string;
  kpis: KpiRow[];
}

export interface SendKpiReportResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export async function sendKpiReportByEmail(input: SendKpiReportInput): Promise<SendKpiReportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "No autenticado" };

  if (!input.recipient || !input.recipient.includes("@")) {
    return { ok: false, error: "Destinatario inválido" };
  }

  // Audit log — quedará persistente cuando la integración SMTP esté.
  // eslint-disable-next-line no-console
  console.log("[KPI report email] requested by", user.email, "to", input.recipient, "periodo", input.fechaDesde, "→", input.fechaHasta, "·", input.kpis.length, "KPIs");

  // TODO Wave 2: integración real con proveedor (Resend, SendGrid, SMTP).
  // Por ahora retornamos OK simulado para que el flujo UI quede listo.
  return {
    ok: true,
    message: `Solicitud registrada (proveedor SMTP pendiente). ${input.kpis.length} KPIs a ${input.recipient}.`,
  };
}
