/**
 * Consumer — 'ece.indicaciones.firmadas' → cola de conciliación farmacia/eMAR.
 *
 * R04 (Code Castle, sprint remediación críticos): el router
 * `indicaciones-medicas.router.ts::firmar()` emite 'ece.indicaciones.firmadas'
 * al outbox transaccional (public."DomainEvent") desde Fase 2, pero nunca
 * existió un consumer — farmacia/eMAR nunca se enteraban de que un médico
 * firmó una indicación.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DESTINO: ece.indicacion_farmacia_pendiente (packages/database/sql/
 * 201_ece_indicacion_farmacia_pendiente.sql — NO aplicado a prod todavía).
 *
 * NO se materializa contra `public.PrescriptionItem` /
 * `public.MedicationAdministration` (el modelo "oficial" de Pharmacy/eMAR):
 * ambos exigen `drugId` NOT NULL (FK duro a `public."Drug"`), y
 * `ece.indicacion_item` NO tiene ningún vínculo estructurado al catálogo de
 * medicamentos — solo `descripcion` en texto libre. Resolver `drugId` desde
 * texto libre requeriría fuzzy-matching ambiguo contra el catálogo
 * (una descripción puede matchear múltiples presentaciones/dosis/
 * fabricantes) — inaceptable para un consumer que alimenta administración
 * de medicamentos. Ver reporte del sprint para el detalle completo.
 *
 * Tampoco se reutiliza `ece.administracion_medicamento` (el "eMAR" nativo de
 * ECE): `registro_enf_id` es NOT NULL y referencia una nota de enfermería
 * por turno que aún no existe al momento de firmar — no se puede precrear
 * ahí una línea "programada". (Hallazgo colateral, verificado contra prod:
 * el CHECK vigente en esa tabla tampoco acepta el vocabulario que usa el
 * router — ver SQL 201, cabecera, y el reporte del sprint.)
 *
 * Los campos dosis/vía/frecuencia se copian VERBATIM desde
 * `ece.indicacion_item` — NO se traduce a la representación de Pharmacy. El
 * farmacéutico revisa la cola y decide manualmente a qué `Drug` corresponde
 * cada ítem antes de dispensar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CONTRATO DE FALLO (no negociable — esto es medicación):
 *
 * `materializeIndicacionFirmadaToFarmacia` NO atrapa excepciones — cualquier
 * error de la BD (constraint violation, conexión perdida, etc.) se propaga
 * al caller. El router la invoca DENTRO de la misma transacción
 * (`withEceContext`) que la firma y el `emitDomainEvent`. Si la
 * materialización falla:
 *
 *   1. La transacción completa hace ROLLBACK — la indicación NO queda
 *      'firmado', el evento NUNCA se persiste en el outbox.
 *   2. El médico recibe un TRPCError visible (ver `firmar()` en
 *      indicaciones-medicas.router.ts) y puede reintentar.
 *
 * Es decir: nunca existe un estado "firmado pero farmacia no se enteró" —
 * o la firma y la materialización suceden juntas (atómico), o ninguna de
 * las dos sucede. Se prefirió este diseño (síncrono, misma transacción)
 * sobre un outbox asíncrono con reintentos porque el único mecanismo de
 * despacho asíncrono establecido en el repo (`notifications.
 * process_outbox_batch`, SQL 44 + Edge Function `notifications-dispatch`)
 * marca `publishedAt` de forma OPTIMISTA antes de confirmar que el
 * consumer tuvo éxito — si la Edge Function falla, el evento queda
 * marcado como publicado y NUNCA se reintenta. Ese patrón es aceptable
 * para notificaciones (best-effort); no lo es para medicación. La
 * escritura de este consumer no tiene dependencias externas (mismo schema
 * `ece`, misma transacción, sin llamada de red ni catálogo GS1/GLN que
 * pueda estar vacío) — acoplarla a la transacción de firma es seguro y no
 * bloquea al médico por causas ajenas a la firma en sí.
 *
 * Idempotencia: `ON CONFLICT (indicacion_item_id) DO NOTHING` — reprocesar
 * el mismo evento (ej. replay manual) nunca duplica filas.
 */
import type { PrismaClient } from "@his/database";

export interface MaterializeIndicacionFirmadaParams {
  indicacionId: string;
  episodioId: string;
  medicoPrescriptorId: string;
  /** id del DomainEvent emitido en la misma transacción — trazabilidad forense. */
  domainEventId?: string | null;
}

export interface MaterializeIndicacionFirmadaResult {
  /** Cantidad de ítems tipo=medicamento materializados a la cola de farmacia. */
  itemsMaterializados: number;
}

/**
 * INSERT ... SELECT ... ON CONFLICT DO NOTHING atómico: toma los ítems
 * tipo=medicamento de la indicación y los copia verbatim a
 * `ece.indicacion_farmacia_pendiente`. Debe llamarse DENTRO de la misma
 * transacción que la firma (mismo `tx` que `withEceContext` entrega al
 * router — el GUC `app.ece_establecimiento_id` ya está seteado ahí).
 *
 * `lower(tipo) = 'medicamento'` en vez de comparar contra el enum TS
 * (`MEDICAMENTO`) porque el CHECK real de `ece.indicacion_item.tipo` en
 * prod usa minúsculas en español (`'medicamento'`) — drift documentado en
 * el reporte del sprint, no corregido aquí (requiere migración de datos +
 * decisión de qué vocabulario gana, fuera de alcance de este consumer).
 * `lower()` cubre ambas grafías sin tomar partido en esa discrepancia.
 *
 * NO atrapa excepciones — ver contrato de fallo en el header del archivo.
 */
export async function materializeIndicacionFirmadaToFarmacia(
  tx: Pick<PrismaClient, "$executeRaw">,
  params: MaterializeIndicacionFirmadaParams,
): Promise<MaterializeIndicacionFirmadaResult> {
  const { indicacionId, episodioId, medicoPrescriptorId, domainEventId } =
    params;

  const affected = await tx.$executeRaw`
    INSERT INTO ece.indicacion_farmacia_pendiente
      (indicacion_id, indicacion_item_id, episodio_id, medico_prescriptor,
       descripcion, dosis, via, frecuencia, duracion, domain_event_id)
    SELECT
      ii.indicacion_id,
      ii.id,
      ${episodioId}::uuid,
      ${medicoPrescriptorId}::uuid,
      ii.descripcion,
      ii.dosis,
      ii.via,
      ii.frecuencia,
      ii.duracion,
      ${domainEventId ?? null}::uuid
    FROM ece.indicacion_item ii
    WHERE ii.indicacion_id = ${indicacionId}::uuid
      AND lower(ii.tipo) = 'medicamento'
    ON CONFLICT (indicacion_item_id) DO NOTHING
  `;

  return { itemsMaterializados: Number(affected) };
}
