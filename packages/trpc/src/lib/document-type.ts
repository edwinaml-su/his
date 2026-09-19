/**
 * CC-A (auditoría 2026-09-18, P1) — tipos de documento por país.
 *
 * `Patient.documentType` acepta desde SQL 255 texto libre (antes: enum
 * Postgres `DocumentType` con 5 valores fijos SV — bloqueaba capturar un
 * paciente guatemalteco con DPI). El contrato Zod (`patient.ts`) sólo valida
 * forma (string 2-40); la validación de que el valor sea uno de los legacy
 * SV (compat, siempre permitidos) O un `IdentifierType.code` activo para el
 * país de la organización corre aquí, server-side.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { documentTypeEnum, validateIdentifier } from "@his/contracts";

/** Códigos con validador de formato reconocido (paridad con `packages/contracts/src/validators`). */
const CODIGOS_CON_VALIDADOR = ["DUI", "NIT", "NIE"] as const;

type TxParaTipoDocumento = Pick<PrismaClient, "identifierType">;

export interface ValidarTipoDocumentoParams {
  countryId: string;
  documentType: string;
  documentNumber?: string | null;
}

/**
 * Lanza `BAD_REQUEST` si `documentType` no es uno de los legacy SV ni un
 * `IdentifierType.code` activo para `countryId`. Si el tipo resuelto tiene
 * un validador de formato reconocido (DUI/NIT/NIE) y viene `documentNumber`,
 * también valida el dígito verificador/estructura.
 */
export async function validarTipoDocumentoPorPais(
  tx: TxParaTipoDocumento,
  params: ValidarTipoDocumentoParams,
): Promise<void> {
  const legacy: readonly string[] = documentTypeEnum.options;
  if (legacy.includes(params.documentType)) {
    // Legacy SV — el formato de DUI ya lo valida el superRefine de
    // `patientCreateSchema`/`patientUpdateSchema` en @his/contracts.
    return;
  }

  const tipo = await tx.identifierType.findFirst({
    where: { countryId: params.countryId, code: params.documentType, active: true },
    select: { code: true },
  });

  if (!tipo) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El tipo de documento "${params.documentType}" no está configurado para el país de la organización.`,
    });
  }

  if (
    params.documentNumber &&
    (CODIGOS_CON_VALIDADOR as readonly string[]).includes(tipo.code) &&
    !validateIdentifier(tipo.code, params.documentNumber)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Documento inválido para el tipo ${tipo.code} (dígito verificador/formato).`,
    });
  }
}
