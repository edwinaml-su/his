/**
 * Consumer — 'ece.indicaciones.firmadas' → `public."Prescription"` +
 * `public."PrescriptionItem"` (ADR 0023 Opción A, punto único de prescripción).
 *
 * Contexto: `docs/adr/0023-punto-unico-de-prescripcion.md` (aceptado por
 * Edwin 2026-09-09) decide que la indicación médica NTEC
 * (`ece.indicacion_item`) es el ÚNICO punto de prescripción — no el módulo
 * Farmacia (`pharmacy.router.ts` `prescription.create`, sin uso real, 0 filas
 * en prod). Este consumer cierra el eslabón estructural: al firmar una
 * indicación con ítems tipo=MEDICAMENTO que tengan `drug_id` (CC-0026, SQL
 * 211), genera automáticamente la `Prescription` (SIGNED) + `PrescriptionItem`
 * correspondiente Y auto-concilia la fila de la cola R04
 * (`ece.indicacion_farmacia_pendiente`, sql/201+222) que `mar-consumer.ts`
 * ya insertó en esta misma transacción — así farmacia/dispensación/BCMA
 * (`bedside.router.ts` `administration.record`) funcionan sin doble captura
 * y sin conciliación manual para el caso estructurado.
 *
 * Ítems tipo=MEDICAMENTO SIN `drug_id` (texto libre legacy) NO generan
 * `Prescription` — la fila de la cola queda `PENDIENTE_REVISION_FARMACIA`
 * exactamente como antes de este cambio; la conciliación manual de farmacia
 * sigue existiendo como fallback (H-01/H-02 de
 * `docs/qa/drhis/R06-evaluacion-datos-farmacologicos.md` documentan por qué
 * ese fallback es hoy el único camino para ese caso).
 *
 * Debe llamarse DENTRO de la misma transacción `withEceContext(...,
 * { tenantContext })` que `firmar()`, DESPUÉS de
 * `materializeIndicacionFirmadaToFarmacia` (mar-consumer.ts) — depende de que
 * la fila de la cola ya exista para poder auto-conciliarla. Mismo contrato de
 * fallo que los demás consumers de `firmar()`: NO atrapa excepciones de
 * infraestructura — si un INSERT/UPDATE falla de verdad (constraint, conexión
 * perdida), la excepción propaga y `firmar()` hace ROLLBACK completo. Las
 * condiciones de "dato insuficiente para generar Rx estructurada" (sin
 * `drug_id`, sin encounter/patient resoluble, sin dosis/vía/frecuencia
 * completas) NO son excepciones: se acumulan en `itemsOmitidos` y la función
 * retorna normalmente — la fila de cola queda como estaba (PENDIENTE), nunca
 * se inventa un dato clínico faltante.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RESOLUCIÓN organizationId / encounterId / patientId (mismo patrón que
 * `care-task-consumer.ts` / `order-consumer.ts`, ver esos archivos para el
 * detalle completo de por qué):
 *   - organizationId: `public.current_org_id_or_ece_context()` (SECURITY
 *     DEFINER, sql/209).
 *   - encounterId/patientId: bridge `ece.episodio_atencion.public_encounter_id`
 *     / `ece.paciente.public_patient_id`, `LEFT JOIN` para degradar a NULL en
 *     vez de tronar. `Prescription.encounterId`/`patientId` son NOT NULL
 *     (a diferencia de `CareTask`, donde son nullable) — si el bridge no
 *     resuelve alguno de los dos, NINGÚN ítem de esta indicación puede
 *     generar su `Prescription`: se listan en `itemsOmitidos` y la firma
 *     sigue adelante (la cola queda PENDIENTE, conciliación manual sigue
 *     disponible).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * GRANTs — hallazgo verificado durante esta ola (2026-09-09): `09_pharmacy_
 * rls.sql` solo otorgó `GRANT SELECT` a `authenticated` sobre
 * `public."Prescription"`/`public."PrescriptionItem"` — nunca INSERT/UPDATE,
 * a pesar de que la policy `prescription_tenant_modify` es `FOR ALL`. Esto es
 * consistente con R06 H-02 ("Prescription = 0 filas en prod", el módulo nunca
 * operó con datos reales — nadie llegó a ejercitar el INSERT contra Postgres
 * real). Cerrado en `packages/database/sql/223_prescription_grants.sql`
 * (INSERT/UPDATE, sin DELETE — medicación no se borra). PENDIENTE DE APPLY.
 * La policy en sí NO necesita tocarse: usa `public.current_org_id()` directo
 * (igual que `LabOrder`/`ImagingRequest`, sql/10), y `firmar()` ya pasa
 * `tenantContext` a `withEceContext` (ver docstring de
 * `EceContextOptions.tenantContext`, rls-context.ts) — eso setea
 * `app.current_org_id` en la misma transacción, exactamente lo que la policy
 * exige. No hace falta un resolver dual-GUC nuevo para esta tabla.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCIA: antes de crear, se consulta si el `indicacion_item_id` ya
 * tiene una fila `RECONCILIADO` con `prescription_item_id` en la cola —
 * en teoría inalcanzable en un flujo normal (`firmar()` solo transiciona
 * borrador→firmado una vez; un segundo intento sobre la misma indicación
 * lanza CONFLICT antes de llegar aquí), pero se guarda de todos modos porque
 * es la única fuente de verdad de "¿ya se generó Rx para este ítem?" — no
 * duplica `Prescription`/`PrescriptionItem` si por cualquier vía (replay,
 * bug futuro) `firmar()` llegara a ejecutar este bloque dos veces para el
 * mismo ítem.
 */
import type { PrismaClient } from "@his/database";

/**
 * Espejo de `AdminRoute` (Prisma, packages/database/prisma/schema.prisma) y
 * `viaAdminEnum` (indicaciones-medicas.router.ts) — no se importa directo
 * desde el router para evitar el ciclo router→consumer→router.
 */
type AdminRouteLiteral =
  | "ORAL"
  | "IV"
  | "IM"
  | "SC"
  | "TOPICAL"
  | "INHALED"
  | "RECTAL"
  | "SUBLINGUAL"
  | "OPHTHALMIC"
  | "OTIC"
  | "NASAL";

const ADMIN_ROUTES = new Set<string>([
  "ORAL",
  "IV",
  "IM",
  "SC",
  "TOPICAL",
  "INHALED",
  "RECTAL",
  "SUBLINGUAL",
  "OPHTHALMIC",
  "OTIC",
  "NASAL",
]);

export interface PrescripcionIndicacionItem {
  /** ece.indicacion_item.id */
  id: string;
  /** Valor crudo de ece.indicacion_item.tipo (CHECK chk_ind_item_tipo, sql/202/211). */
  tipo: string;
  descripcion: string;
  dosis: string | null;
  via: string | null;
  frecuencia: string | null;
  duracion: string | null;
  /** CC-0026 Ola 2 (SQL 211) — FK a public."Drug". NULL = texto libre legacy. */
  drugId: string | null;
}

export interface MaterializePrescripcionParams {
  indicacionId: string;
  episodioId: string;
  /** ece.indicaciones_medicas.medico_prescriptor — ya es un public."User".id (ver create() del router). */
  prescriberId: string;
  items: PrescripcionIndicacionItem[];
}

export interface ItemPrescripcionOmitido {
  descripcion: string;
  motivo: string;
}

export interface MaterializePrescripcionResult {
  /** null si no se generó ninguna Prescription (sin ítems elegibles, o todos ya conciliados). */
  prescriptionId: string | null;
  itemsPrescritos: number;
  itemsOmitidos: ItemPrescripcionOmitido[];
}

interface RxReadyItem {
  id: string;
  descripcion: string;
  dosis: string;
  via: AdminRouteLiteral;
  frecuencia: string;
  duracion: string | null;
  drugId: string;
}

/**
 * Valida que un ítem MEDICAMENTO con drug_id tenga los datos estructurados
 * mínimos para una PrescriptionItem (dosage/route/frequency son NOT NULL en
 * el modelo Prisma). `ece.indicacion_item.dosis/via/frecuencia` son
 * nullable a nivel de columna (columnas genéricas compartidas por todos los
 * tipos de ítem) — un MEDICAMENTO con drug_id pero sin estos datos no puede
 * materializar Rx estructurada; NO es el caso esperado (la UI del CPOE los
 * pide), pero se maneja como omisión defensiva, no como excepción.
 */
function tryBuildRxReadyItem(item: PrescripcionIndicacionItem): RxReadyItem | null {
  if (
    item.drugId == null ||
    !item.dosis?.trim() ||
    !item.via ||
    !ADMIN_ROUTES.has(item.via) ||
    !item.frecuencia?.trim()
  ) {
    return null;
  }
  return {
    id: item.id,
    descripcion: item.descripcion,
    dosis: item.dosis,
    via: item.via as AdminRouteLiteral,
    frecuencia: item.frecuencia,
    duracion: item.duracion,
    drugId: item.drugId,
  };
}

/**
 * Genera Prescription+PrescriptionItem para los ítems MEDICAMENTO con
 * drug_id de una indicación recién firmada, y auto-concilia la fila
 * correspondiente de `ece.indicacion_farmacia_pendiente`. Debe llamarse
 * DENTRO de la misma transacción `withEceContext(..., { tenantContext })`
 * que `firmar()`, DESPUÉS de `materializeIndicacionFirmadaToFarmacia`.
 *
 * NO atrapa excepciones de infraestructura — ver contrato de fallo en el
 * header del archivo. "Sin drug_id" / "sin datos estructurados completos" /
 * "encounter o patient no resoluble" NO son excepciones: se acumulan en
 * `itemsOmitidos` (o simplemente no se procesan, si drug_id es null — ese
 * caso ni se reporta, es el camino legacy esperado) y la función retorna
 * normalmente.
 */
export async function materializePrescripcionFromIndicacion(
  tx: PrismaClient,
  params: MaterializePrescripcionParams,
): Promise<MaterializePrescripcionResult> {
  const { episodioId, prescriberId, items } = params;

  const itemsOmitidos: ItemPrescripcionOmitido[] = [];
  const rxReady: RxReadyItem[] = [];

  for (const item of items) {
    if (item.tipo.toUpperCase() !== "MEDICAMENTO" || item.drugId == null) {
      // Sin drug_id: camino legacy esperado (texto libre) — no se reporta
      // como omisión, la cola queda PENDIENTE_REVISION_FARMACIA tal cual.
      continue;
    }
    const ready = tryBuildRxReadyItem(item);
    if (!ready) {
      itemsOmitidos.push({
        descripcion: item.descripcion,
        motivo:
          "Ítem MEDICAMENTO con drug_id pero sin dosis/vía/frecuencia estructurada " +
          "completa — no se puede generar Prescription automática. Requiere " +
          "conciliación manual en farmacia.",
      });
      continue;
    }
    rxReady.push(ready);
  }

  if (rxReady.length === 0) {
    return { prescriptionId: null, itemsPrescritos: 0, itemsOmitidos };
  }

  const orgRows = await tx.$queryRaw<{ org_id: string | null }[]>`
    SELECT public.current_org_id_or_ece_context()::text AS org_id
  `;
  const organizationId = orgRows[0]?.org_id ?? null;
  if (!organizationId) {
    throw new Error(
      "materializePrescripcionFromIndicacion: public.current_org_id_or_ece_context() " +
        "devolvió NULL — no se puede resolver organizationId para Prescription.",
    );
  }

  const bridgeRows = await tx.$queryRaw<
    { encounter_id: string | null; patient_id: string | null }[]
  >`
    SELECT
      ea.public_encounter_id::text AS encounter_id,
      p.public_patient_id::text AS patient_id
    FROM ece.episodio_atencion ea
    LEFT JOIN ece.paciente p ON p.id = ea.paciente_id
    WHERE ea.id = ${episodioId}::uuid
  `;
  const encounterId = bridgeRows[0]?.encounter_id ?? null;
  const patientId = bridgeRows[0]?.patient_id ?? null;

  if (!encounterId || !patientId) {
    const motivo =
      "No se pudo resolver encounter/patient del episodio (bridge ece.episodio_atencion/" +
      "ece.paciente → public.Encounter/Patient sin ACL) — Prescription exige ambos " +
      "NOT NULL. La conciliación de este ítem queda pendiente para farmacia.";
    for (const item of rxReady) {
      itemsOmitidos.push({ descripcion: item.descripcion, motivo });
    }
    return { prescriptionId: null, itemsPrescritos: 0, itemsOmitidos };
  }

  // Idempotencia — ver header del archivo.
  const rxReadyIds = rxReady.map((i) => i.id);
  const existingRows = await tx.$queryRaw<
    { indicacion_item_id: string; prescription_item_id: string }[]
  >`
    SELECT indicacion_item_id::text, prescription_item_id::text
    FROM ece.indicacion_farmacia_pendiente
    WHERE indicacion_item_id = ANY(${rxReadyIds}::uuid[])
      AND estado = 'RECONCILIADO'
      AND prescription_item_id IS NOT NULL
  `;
  const yaConciliados = new Set(existingRows.map((r) => r.indicacion_item_id));
  const pending = rxReady.filter((i) => !yaConciliados.has(i.id));

  if (pending.length === 0) {
    // Todos los ítems ya estaban conciliados (replay/reintento) — no duplicar.
    const primerExistente = existingRows[0];
    const prescriptionItem = primerExistente
      ? await tx.prescriptionItem.findUnique({
          where: { id: primerExistente.prescription_item_id },
          select: { prescriptionId: true },
        })
      : null;
    return {
      prescriptionId: prescriptionItem?.prescriptionId ?? null,
      itemsPrescritos: 0,
      itemsOmitidos,
    };
  }

  const prescription = await tx.prescription.create({
    data: {
      organizationId,
      encounterId,
      prescriberId,
      patientId,
      status: "SIGNED",
      signedAt: new Date(),
      notes:
        "Generada automáticamente al firmar la indicación médica NTEC " +
        "(ADR 0023 Opción A — punto único de prescripción).",
    },
  });

  let itemsPrescritos = 0;
  for (const item of pending) {
    const prescriptionItem = await tx.prescriptionItem.create({
      data: {
        prescriptionId: prescription.id,
        drugId: item.drugId,
        dosage: item.dosis,
        route: item.via,
        frequency: item.frecuencia,
        notes: item.duracion
          ? `${item.descripcion} — Duración: ${item.duracion}`
          : item.descripcion,
      },
    });

    // Auto-conciliación ADR 0023 Opción A: la fila R04 que mar-consumer.ts
    // insertó como PENDIENTE_REVISION_FARMACIA en esta misma transacción
    // queda RECONCILIADA con el PrescriptionItem recién generado.
    // reconciliado_por queda NULL a propósito: esa columna referencia
    // ece.personal_salud(id), no public."User".id (mismo espacio de ids que
    // `prescriberId`) — ver identity-resolver.ts para la trampa completa de
    // los dos espacios. Setear ahí `prescriberId` violaría la FK.
    await tx.$executeRaw`
      UPDATE ece.indicacion_farmacia_pendiente
      SET estado = 'RECONCILIADO',
          prescription_item_id = ${prescriptionItem.id}::uuid,
          reconciliado_en = now()
      WHERE indicacion_item_id = ${item.id}::uuid
    `;
    itemsPrescritos += 1;
  }

  return { prescriptionId: prescription.id, itemsPrescritos, itemsOmitidos };
}
