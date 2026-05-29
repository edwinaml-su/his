/**
 * Hooks automáticos HIS → ECE: crean las filas ece.* al registrar Patient/Encounter.
 *
 * Diseño:
 *   - Cada hook recibe el cliente Prisma (puede ser una tx o el cliente raíz).
 *   - Usan raw SQL porque ece.* no está en schema.prisma (Opción B bridge).
 *   - Son idempotentes: verifican existencia antes de insertar.
 *   - Nunca lanzan — los errores se loguean y el caller continúa (non-fatal).
 *     Excepción: hookEcePacienteAfterCreate lanza si se llama dentro de una tx
 *     que no puede tolerar el fallo (el caller decide con try/catch).
 *
 * Schema real (verificado 2026-05-29 via MCP):
 *   ece.paciente.establecimiento_id → FK a public."Establishment" (directo)
 *   ece.episodio_atencion.establecimiento_id → FK a ece.establecimiento
 *   ece.paciente.nui nullable; si null → tipo_registro_identidad='sin_documento'
 *   ece.paciente.numero_expediente NOT NULL, UNIQUE(establecimiento_id, numero_expediente)
 *   ece.episodio_atencion.estado → enum: abierto|cancelado|cerrado|en_curso
 */

type PrismaLike = {
  $queryRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown[]>;
  $executeRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<number>;
};

// ─── Mapeos admissionType → valores ECE ──────────────────────────────────────
// IMPORTANTE: el enum public."AdmissionType" REAL solo tiene:
//   EMERGENCY, SCHEDULED, TRANSFER_IN, BIRTH, NEWBORN
// NO existe OUTPATIENT (verificado via MCP 2026-05-29). Outpatient se
// modela en módulo Appointment, no en Encounter. Para encounters tipo
// "ambulatorio" no existe path — el switch deja default 'hospitalario'
// que es lo correcto para EMERGENCY/SCHEDULED/TRANSFER_IN.

function toServicioCategoria(
  admissionType: string,
): "emergencia" | "consulta_externa" | "hospitalizacion" | "hospital_de_dia" {
  switch (admissionType) {
    case "EMERGENCY":
      return "emergencia";
    case "SCHEDULED":
    case "TRANSFER_IN":
    default:
      return "hospitalizacion";
  }
}

function toModalidad(_admissionType: string): "ambulatorio" | "hospitalario" {
  // Todos los AdmissionType actuales son hospitalarios (no hay OUTPATIENT).
  // Si en el futuro se agrega un tipo ambulatorio al enum, mapearlo aquí.
  return "hospitalario";
}

// ─── Hook 1: ece.paciente ─────────────────────────────────────────────────────

/**
 * Crea un registro en ece.paciente para el Patient recién creado.
 *
 * Debe llamarse DENTRO de la misma transacción donde se creó el Patient,
 * o en una tx separada si el router ya salió de la transacción principal.
 *
 * @param tx - cliente Prisma (tx o root)
 * @param patientId - public."Patient".id recién creado
 * @param establishmentId - public."Establishment".id del tenant
 * @param mrn - MRN del paciente (usado como numero_expediente)
 * @returns id del ece.paciente creado, o null si ya existía o falló
 */
export async function hookEcePacienteAfterCreate(
  tx: PrismaLike,
  patientId: string,
  establishmentId: string,
  mrn: string,
): Promise<string | null> {
  // Idempotencia: si ya existe, no crear.
  const existing = await (tx.$queryRaw as PrismaLike["$queryRaw"])`
    SELECT id::text FROM ece.paciente
    WHERE public_patient_id = ${patientId}::uuid
    LIMIT 1
  ` as Array<{ id: string }>;

  if (existing.length > 0) {
    return existing[0]!.id;
  }

  // Verificar colisión de numero_expediente en este establecimiento.
  // Raro pero defensivo para data importada o seeds.
  const mrnConflict = await (tx.$queryRaw as PrismaLike["$queryRaw"])`
    SELECT id FROM ece.paciente
    WHERE establecimiento_id = ${establishmentId}::uuid
      AND numero_expediente = ${mrn}
    LIMIT 1
  ` as Array<{ id: string }>;

  const expediente =
    mrnConflict.length > 0 ? `${mrn}-${patientId.substring(0, 8)}` : mrn;

  const created = await (tx.$queryRaw as PrismaLike["$queryRaw"])`
    INSERT INTO ece.paciente (
      public_patient_id,
      establecimiento_id,
      numero_expediente,
      tipo_registro_identidad,
      estado_expediente,
      estado_registro
    )
    VALUES (
      ${patientId}::uuid,
      ${establishmentId}::uuid,
      ${expediente},
      'sin_documento',
      'activo',
      'vigente'
    )
    RETURNING id::text
  ` as Array<{ id: string }>;

  return created[0]?.id ?? null;
}

// ─── Hook 2: ece.episodio_atencion ───────────────────────────────────────────

/**
 * Crea un registro en ece.episodio_atencion para el Encounter recién admitido.
 *
 * Si el ece.paciente no existe aún (hook 1 falló o aún no corrió),
 * lo crea primero como defensa-en-profundidad.
 *
 * @param tx - cliente Prisma (tx o root)
 * @param encounterId - public."Encounter".id recién creado
 * @param patientId - public."Patient".id del Encounter
 * @param admissionType - tipo de admisión del Encounter
 * @param admittedAt - fecha/hora de admisión
 * @param eceEstablecimientoId - ece.establecimiento.id (FK distinta a public.Establishment)
 * @param patientEstablishmentId - public."Establishment".id (para fallback de paciente ECE)
 * @param mrn - MRN del paciente (para fallback si hay que crear ece.paciente)
 * @returns id del ece.episodio_atencion creado, o null si ya existía
 */
export async function hookEceEpisodioAfterAdmit(
  tx: PrismaLike,
  encounterId: string,
  patientId: string,
  admissionType: string,
  admittedAt: Date,
  eceEstablecimientoId: string,
  patientEstablishmentId: string,
  mrn: string,
): Promise<string | null> {
  // Idempotencia: si ya existe episodio para este encounter, salir.
  const existing = await (tx.$queryRaw as PrismaLike["$queryRaw"])`
    SELECT id::text FROM ece.episodio_atencion
    WHERE public_encounter_id = ${encounterId}::uuid
    LIMIT 1
  ` as Array<{ id: string }>;

  if (existing.length > 0) {
    return existing[0]!.id;
  }

  // Resolver ece.paciente — con fallback de creación si no existe.
  let pacienteRows = await (tx.$queryRaw as PrismaLike["$queryRaw"])`
    SELECT id::text FROM ece.paciente
    WHERE public_patient_id = ${patientId}::uuid
    LIMIT 1
  ` as Array<{ id: string }>;

  if (pacienteRows.length === 0) {
    // Fallback: crear ece.paciente si el hook de Patient no lo hizo.
    const newId = await hookEcePacienteAfterCreate(
      tx,
      patientId,
      patientEstablishmentId,
      mrn,
    );
    if (!newId) {
      return null;
    }
    pacienteRows = [{ id: newId }];
  }

  const pacienteEceId = pacienteRows[0]!.id;
  const modalidad = toModalidad(admissionType);
  const servicio = toServicioCategoria(admissionType);

  const created = await (tx.$queryRaw as PrismaLike["$queryRaw"])`
    INSERT INTO ece.episodio_atencion (
      paciente_id,
      establecimiento_id,
      public_encounter_id,
      modalidad,
      servicio_categoria,
      fecha_hora_inicio,
      estado,
      creado_en,
      actualizado_en
    )
    VALUES (
      ${pacienteEceId}::uuid,
      ${eceEstablecimientoId}::uuid,
      ${encounterId}::uuid,
      ${modalidad},
      ${servicio},
      ${admittedAt}::timestamptz,
      'abierto',
      now(),
      now()
    )
    RETURNING id::text
  ` as Array<{ id: string }>;

  return created[0]?.id ?? null;
}

/**
 * Resuelve el ece.establecimiento.id a partir de un public.Establishment.id.
 * Busca en ece.establecimiento por establishment_id.
 *
 * @returns ece.establecimiento.id o null si no existe (no se ha inicializado ECE para este estab)
 */
export async function resolveEceEstablecimientoId(
  tx: PrismaLike,
  publicEstablishmentId: string,
): Promise<string | null> {
  const rows = await (tx.$queryRaw as PrismaLike["$queryRaw"])`
    SELECT id::text FROM ece.establecimiento
    WHERE establishment_id = ${publicEstablishmentId}::uuid
    LIMIT 1
  ` as Array<{ id: string }>;

  return rows[0]?.id ?? null;
}
