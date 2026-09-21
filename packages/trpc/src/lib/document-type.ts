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

/** Códigos con validador de formato reconocido (paridad con `packages/contracts/src/validators`) — algoritmos SALVADOREÑOS únicamente. */
const CODIGOS_CON_VALIDADOR = ["DUI", "NIT", "NIE"] as const;

/** ISO 3166-1 alpha-3 de El Salvador — único país cuyo NIT/NIE usa el algoritmo de `validateIdentifier`. */
const ISO_ALPHA3_SV = "SLV";

type TxParaTipoDocumento = Pick<PrismaClient, "identifierType">;

export interface ValidarTipoDocumentoParams {
  countryId: string;
  documentType: string;
  documentNumber?: string | null;
}

/**
 * Lanza `BAD_REQUEST` si `documentType` no es uno de los legacy SV ni un
 * `IdentifierType.code` activo para `countryId`. Si el tipo resuelto
 * PERTENECE A EL SALVADOR y tiene un validador de formato reconocido
 * (DUI/NIT/NIE), también valida el dígito verificador/estructura — el
 * algoritmo de `validateIdentifier` es específico del NIT/NIE salvadoreño
 * (módulo 11 con pesos fijos); un `IdentifierType(GT,'NIT')` u otro país que
 * reutilice el código "NIT" NO se valida con ese algoritmo (rechazaría NITs
 * legítimos de otro país) — queda solo con el check estructural por defecto
 * de `validateIdentifier` (no vacío), igual que DPI/PASSPORT/MINOR_ID.
 */
export async function validarTipoDocumentoPorPais(
  tx: TxParaTipoDocumento,
  params: ValidarTipoDocumentoParams,
): Promise<void> {
  const legacy: readonly string[] = documentTypeEnum.options;
  if (legacy.includes(params.documentType)) {
    // Legacy SV — el formato de DUI lo valida el superRefine de
    // `patientCreateSchema` en @his/contracts (create únicamente:
    // `patientUpdateSchema` es `.partial()` sin superRefine, igual que en
    // main — un DUI inválido en `update` NO se rechaza hoy; fuera de
    // alcance de este helper, es un gap preexistente del contrato Zod).
    return;
  }

  const tipo = await tx.identifierType.findFirst({
    where: { countryId: params.countryId, code: params.documentType, active: true },
    select: { code: true, country: { select: { isoAlpha3: true } } },
  });

  if (!tipo) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `El tipo de documento "${params.documentType}" no está configurado para el país de la organización.`,
    });
  }

  const esIdentifierTypeDeSV = tipo.country?.isoAlpha3 === ISO_ALPHA3_SV;

  if (
    esIdentifierTypeDeSV &&
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
