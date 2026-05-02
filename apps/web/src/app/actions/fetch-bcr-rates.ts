"use server";

/**
 * Server Action — US-1.3 Importación de tasas BCR (Banco Central de Reserva SV).
 *
 * MVP: stub que devuelve un payload mock con tasas oficiales SV. La integración
 * real con el feed BCR (https://www.bcr.gob.sv) queda fuera de alcance para
 * Sprint 1; el equipo SRE necesita acordar credenciales/webhook con el BCR.
 *
 * Comportamiento actual:
 *   - No hace fetch externo.
 *   - No persiste en BD: el caller (UI) recibe la lista y decide qué tasas
 *     importar via `exchangeRate.create`. Esto evita duplicar la lógica de
 *     versionado (cierre de cadena temporal) que ya está en el router.
 *   - Loggea un warn estructurado para que el operador sepa que está viendo
 *     datos mock.
 *
 * Datos mock (USD ↔ SVC, OFFICIAL):
 *   - 8.75 SVC por 1 USD — tasa de paridad histórica (Ley de Integración
 *     Monetaria 2001, Art. 1). Aunque SVC dejó de circular tras dolarización,
 *     se mantiene en el sistema para reportes contables retroactivos y
 *     conciliación con balances anteriores a 2001.
 *   - validFrom: 2001-01-01 (paridad legal). El operador puede ajustar antes
 *     de persistir.
 *   - Inversa (1 USD por 8.75 SVC ≈ 0.11428571) también se sugiere.
 *
 * TODO(Sprint 5): integración real BCR.
 *   - Consumir feed JSON/XML diario.
 *   - Manejar autenticación si BCR requiere API key.
 *   - Re-intentos con backoff exponencial.
 *   - Cache 6h para no saturar el endpoint.
 *   - Detectar cambios y solo retornar deltas.
 *   - Auditar cada import en `audit.AuditLog` (action=FX_IMPORT_BCR).
 *   - Considerar feed regional (Banguat GT, BCH HN, BCN NI, BCCR CR).
 */

import { z } from "zod";

export type BcrRateSuggestion = {
  /** ISO 4217 origen — el caller debe resolver el currencyId. */
  fromIsoCode: string;
  /** ISO 4217 destino. */
  toIsoCode: string;
  /** Tipo de tasa BCR (siempre OFFICIAL en MVP). */
  rateType: "OFFICIAL" | "BUY" | "SELL" | "AVERAGE" | "FISCAL";
  /** Decimal positivo serializado como string para preservar precisión. */
  rate: string;
  /** Fecha de vigencia ISO 8601. */
  validFrom: string;
  /** Source descriptor: "BCR-mock" en MVP, "BCR" tras integración real. */
  source: string;
  /** Nota explicativa para el operador (UI la muestra en tooltip). */
  note?: string;
};

export type FetchBcrRatesResult = {
  ok: true;
  /** True cuando los datos son mock (todo Sprint 1). */
  mock: boolean;
  /** Aviso human-readable mostrado en la UI. */
  warning: string;
  /** Tasas sugeridas — el usuario las revisa antes de persistir. */
  rates: BcrRateSuggestion[];
  /** Timestamp del fetch (server-side). */
  fetchedAt: string;
};

const MOCK_FETCHED_AT = () => new Date().toISOString();

/**
 * MOCK: paridad legal SVC ↔ USD según Ley de Integración Monetaria 2001.
 * No es la "tasa BCR del día" — el BCR ya no publica tipo de cambio para SVC
 * porque la moneda no circula. La incluimos para que admins puedan registrar
 * la tasa histórica en el sistema (necesaria para reportes contables que
 * todavía referencian montos en colones).
 */
const MOCK_RATES: BcrRateSuggestion[] = [
  {
    fromIsoCode: "USD",
    toIsoCode: "SVC",
    rateType: "OFFICIAL",
    rate: "8.75000000",
    validFrom: "2001-01-01T00:00:00.000Z",
    source: "BCR-mock",
    note: "Paridad legal Ley de Integración Monetaria SV (Art. 1).",
  },
  {
    fromIsoCode: "SVC",
    toIsoCode: "USD",
    rateType: "OFFICIAL",
    rate: "0.11428571",
    validFrom: "2001-01-01T00:00:00.000Z",
    source: "BCR-mock",
    note: "Inversa de paridad legal (1 / 8.75).",
  },
];

/**
 * Schema defensivo para validar el output mock. En la integración real este
 * mismo schema valida la respuesta del feed BCR (defensa contra cambios de
 * contrato del proveedor).
 */
const bcrRateSuggestionSchema = z.object({
  fromIsoCode: z.string().length(3),
  toIsoCode: z.string().length(3),
  rateType: z.enum(["BUY", "SELL", "AVERAGE", "OFFICIAL", "FISCAL"]),
  rate: z.string().regex(/^\d+(\.\d{1,8})?$/),
  validFrom: z.string().datetime(),
  source: z.string().min(1).max(80),
  note: z.string().optional(),
});

const bcrFeedSchema = z.array(bcrRateSuggestionSchema);

/**
 * Devuelve sugerencias de tasas BCR. Mock en MVP; el caller debe mostrar el
 * `warning` al operador y permitir confirmar antes de invocar
 * `exchangeRate.create` por cada fila aceptada.
 *
 * No requiere argumentos: el feed BCR siempre publica el set completo del día.
 * Tras la integración real podría aceptar `{ at?: Date }` para queries
 * retroactivas, pero eso es Sprint 5.
 */
export async function fetchBcrRates(): Promise<FetchBcrRatesResult> {
  // TODO(Sprint 5): reemplazar por fetch real.
  //   const res = await fetch("https://www.bcr.gob.sv/feed/exchange-rates", {
  //     headers: { "X-Api-Key": process.env.BCR_API_KEY ?? "" },
  //     next: { revalidate: 6 * 3600 }, // cache 6h
  //   });
  //   if (!res.ok) throw new Error(`BCR feed error: ${res.status}`);
  //   const json = await res.json();
  //   const rates = bcrFeedSchema.parse(json.rates);

  // Validamos el mock con el mismo schema para asegurar que cumple el
  // contrato esperado por la UI cuando llegue el feed real.
  const rates = bcrFeedSchema.parse(MOCK_RATES);

  // Log estructurado para que el operador y SRE sepan que esto sigue siendo
  // mock — útil filtrando logs en producción cuando la integración real
  // todavía no esté lista.
  // eslint-disable-next-line no-console
  console.warn("[fetch-bcr-rates] Devolviendo datos MOCK. TODO Sprint 5: integración real BCR.");

  return {
    ok: true,
    mock: true,
    warning: "Integración real BCR pendiente Sprint 5. Mostrando tasas oficiales SV mock (paridad histórica USD/SVC=8.75).",
    rates,
    fetchedAt: MOCK_FETCHED_AT(),
  };
}
