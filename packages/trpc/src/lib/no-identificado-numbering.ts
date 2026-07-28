/**
 * CC-0008b — Generador del código de identidad temporal del "Paciente no
 * identificado" (emergencia: sin documento, sin acompañante, inconsciente).
 *
 * Formato: DDMMAAAA-NN
 *   - DDMMAAAA → fecha del día del registro (UTC, igual criterio que
 *     expediente-numbering.ts para determinismo servidor).
 *   - NN       → correlativo de 2 dígitos con ceros, versionado por
 *     (organization_id, fecha) — reinicia cada día.
 *
 * Deliberadamente distinto del NN-yyyyMMdd-HHmmss de triage.router.ts (no
 * tocar ese flujo — precedente documentado en CLAUDE.md/briefing de la tarea).
 *
 * La atomicidad la garantiza el upsert INSERT ... ON CONFLICT DO UPDATE de
 * fn_next_no_identificado (SECURITY DEFINER), espejo de fn_next_expediente
 * (packages/database/sql/176_cc0002_expediente.sql).
 *
 * Debe llamarse DENTRO de una transacción Prisma activa.
 */

/** Tipo mínimo del cliente de transacción que necesita este helper. */
type TxForNoIdentificado = {
  $queryRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown[]>;
};

function formatFechaDDMMAAAA(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}${mm}${yyyy}`;
}

/**
 * Genera el código de identidad temporal para el paciente no identificado.
 *
 * @param tx             - cliente Prisma dentro de una transacción activa
 * @param organizationId - organización del tenant (bucket del correlativo diario)
 * @param fecha          - fecha del registro (default: ahora)
 * @returns código formateado, ej. '27072026-01'
 */
export async function nextNoIdentificadoLabel(
  tx: TxForNoIdentificado,
  organizationId: string,
  fecha: Date = new Date(),
): Promise<string> {
  const fechaISO = fecha.toISOString().slice(0, 10); // yyyy-mm-dd (bucket SQL)

  const rows = (await tx.$queryRaw`
    SELECT public.fn_next_no_identificado(${organizationId}::uuid, ${fechaISO}::date) AS n
  `) as Array<{ n: number }>;

  const n = rows[0]?.n;
  if (n == null) {
    throw new Error(
      `fn_next_no_identificado no devolvió valor para (${organizationId}, ${fechaISO})`,
    );
  }

  return `${formatFechaDDMMAAAA(fecha)}-${String(n).padStart(2, "0")}`;
}
