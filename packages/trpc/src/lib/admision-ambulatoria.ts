/**
 * CC-0036 Ola 4 (REQ-HIS-AFIL-001 US.AGE.2.6 AC1/AC4) — creación del
 * `Encounter` ambulatorio disparado por el check-in de una cita.
 *
 * Decisión de diseño (documentada, no trivial): `AdmissionType` (enum
 * Prisma) NO tiene un valor ambulatorio — solo EMERGENCY | SCHEDULED |
 * TRANSFER_IN | BIRTH | NEWBORN, y 24 archivos consumen ese enum (ECE hooks,
 * BI cube, censo, triage, bridges). Agregar un valor nuevo tenía un radio de
 * impacto desproporcionado para esta ola. Se reutiliza `SCHEDULED` (ya usado
 * para admisiones programadas) SIN pasar por `encounterRouter.admit()`
 * completo: ese handler EXIGE `bedId` para SCHEDULED (rama inaplicable a una
 * consulta externa) y asigna GSRN/EPCIS de admisión hospitalaria (US.F2.6.1,
 * explícitamente "confirmar admisión HOSPITALARIA" — no aplica aquí).
 *
 * Lo que SÍ se reutiliza tal cual, sin duplicar (mismo criterio que exige el
 * REQ): `nextEncounterNumber` (numeración) y `hookEceEpisodioAfterAdmit` +
 * `resolveEceEstablecimientoId` (episodio NTEC atómico, ADR 0024 — el fallo
 * revierte la transacción completa, igual que en `admit()`).
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { nextEncounterNumber } from "./encounter-numbering";
import { hookEceEpisodioAfterAdmit, resolveEceEstablecimientoId } from "./ece-hooks";
import { applyWorkflowContext } from "../workflow/context";
import { resolverTasaFuncional } from "./exchange";

export interface CrearEncounterAmbulatorioParams {
  organizationId: string;
  establishmentId: string;
  serviceUnitId: string | null;
  patientId: string;
  admittedAt: Date;
  createdBy: string;
}

/**
 * Crea el `Encounter` ambulatorio de una cita. Debe llamarse DENTRO de una
 * transacción con contexto de tenant ya aplicado (mismo contrato que
 * `encounterRouter.admit`). El caller es responsable de la idempotencia
 * (en checkIn: verificar `OutpatientAppointment.encounterId` ANTES de
 * llamar a este helper — no se re-chequea acá).
 */
export async function crearEncounterAmbulatorio(
  tx: PrismaClient,
  params: CrearEncounterAmbulatorioParams,
): Promise<{ id: string; encounterNumber: string }> {
  await applyWorkflowContext(tx, {
    personalId: params.createdBy,
    establecimientoId: params.establishmentId,
  });

  const org = await tx.organization.findUnique({
    where: { id: params.organizationId },
    select: { functionalCurrency: true, countryId: true },
  });
  if (!org?.functionalCurrency) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Moneda no definida para la organización." });
  }

  const encounterNumber = await nextEncounterNumber(tx, params.organizationId);

  // CC-A (auditoría 2026-09-18, P0) — la cuenta ambulatoria siempre se abre
  // en la moneda funcional de la organización (línea de arriba), así que
  // esto resuelve a 1 por el camino corto (sin query extra a ExchangeRate).
  // Se cablea igual para no dejar un `1` sin pasar por el resolver único.
  const exchangeRateToFunc = await resolverTasaFuncional(tx, {
    organizationId: params.organizationId,
    currencyId: org.functionalCurrency,
    functionalCurrencyId: org.functionalCurrency,
  });

  const encounter = await tx.encounter.create({
    data: {
      countryId: org.countryId,
      organizationId: params.organizationId,
      establishmentId: params.establishmentId,
      serviceUnitId: params.serviceUnitId,
      patientId: params.patientId,
      admissionType: "SCHEDULED",
      admittedAt: params.admittedAt,
      encounterNumber,
      currencyId: org.functionalCurrency,
      exchangeRateToFunc,
      createdBy: params.createdBy,
    },
  });

  // Hook ECE — P0-4 FAIL-FAST (ADR 0024): mismo criterio que admit(). El
  // episodio NTEC es atómico con el encuentro; si falla, revierte la tx.
  const eceEstabId = await resolveEceEstablecimientoId(tx, params.establishmentId);
  if (!eceEstabId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "El establecimiento no tiene su espejo ECE (ece.establecimiento). " +
        "El check-in no puede continuar sin expediente NTEC — contacte a administración.",
    });
  }

  const patient = await tx.patient.findFirst({
    where: { id: params.patientId },
    select: { id: true, mrn: true },
  });
  if (!patient) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado al crear el episodio ECE." });
  }

  const episodioId = await hookEceEpisodioAfterAdmit(
    tx,
    encounter.id,
    params.patientId,
    "SCHEDULED",
    encounter.admittedAt,
    eceEstabId,
    params.establishmentId,
    patient.mrn,
  );
  if (!episodioId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se pudo crear el episodio ECE del check-in (expediente NTEC). El check-in fue revertido.",
    });
  }

  return { id: encounter.id, encounterNumber };
}
