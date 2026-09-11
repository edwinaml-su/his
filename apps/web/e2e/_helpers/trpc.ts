/**
 * Cliente tRPC mínimo para specs E2E que necesitan leer/mutar por API además
 * de manejar la UI — RN-HIS-BOT-001 (docs/48 C5-2, cargos-rn-bot-001.spec.ts).
 *
 * Por qué esto y no `trpc.createClient()` del app: las specs corren en Node
 * (contexto de Playwright), no en el bundle del navegador — no hay React
 * Query ni el `TRPCProvider` de apps/web/src/lib/trpc/react.tsx disponibles.
 * En cambio, `page.request`/`context.request` de Playwright SÍ comparten las
 * cookies de sesión de la página ya logueada (mismo browser context), así
 * que una llamada HTTP directa a `/api/trpc/<path>` queda autenticada igual
 * que la UI — sin duplicar ningún secreto ni tocar la BD directamente.
 *
 * Formato de wire — dos casos, verificados leyendo el adapter fetch
 * instalado (node_modules/@trpc/server/dist/resolveResponse-*.mjs), NO de
 * memoria; el proyecto usa httpBatchLink+superjson
 * (apps/web/src/lib/trpc/react.tsx):
 *
 *   1. Llamadas de ESTE helper (`trpcQuery`/`trpcMutate`, sin `?batch=1`):
 *      el server toma `isBatchCall = searchParams.get("batch")==="1"` como
 *      false y responde un ÚNICO envelope `{ result: { data: {...} } }` o
 *      `{ error: {...} } }` — confirmado además por
 *      `apps/web/e2e/fase2/pharmacy-cart.spec.ts`, que ya hace
 *      `request.get("/api/trpc/pharmacyCart.list")` sin batch.
 *   2. Respuestas de la UI capturadas con `page.waitForResponse`
 *      (`parseTrpcResponse`): el cliente del navegador SIEMPRE usa
 *      httpBatchLink (`?batch=1`, aunque sea una sola llamada) — el server
 *      responde un ARRAY de envelopes, uno por llamada del batch (visto en
 *      los mocks de `apps/web/e2e/fase2/pharmacy-picking.spec.ts`, que
 *      interceptan esa misma ruta con `body: JSON.stringify([{ result: {...} }])`).
 *
 *   `unwrap()` normaliza ambos casos (toma `body[0]` si `body` es array)
 *   antes de leer `result.data`/`error`.
 *
 *   El `input`/`data` de cada llamada, bacheada o no, es
 *   `superjson.serialize(valor)` → `{ json: valor, meta?: {...} }` (para un
 *   objeto plano de strings/numbers/uuids, sin `meta`). Los campos
 *   `Decimal` de Prisma (unitPrice/quantity/totalPrice) NO tienen
 *   transformer custom registrado (grep sobre packages/trpc/src/trpc.ts) —
 *   `Decimal.toJSON()` los deja como STRING dentro de `json`
 *   (comportamiento nativo de decimal.js vía `JSON.stringify`), no como
 *   number — por eso `decimalToNumber()` abajo. Los `Date` (resolvedAt/
 *   createdAt/...) sí tienen soporte nativo de superjson y llegan como ISO
 *   string dentro de `json` (la anotación de tipo vive en `meta`, que este
 *   helper no lee).
 *
 * ⚠ No verificado contra un servidor real corriendo (el stack Docker de
 * docker-compose.test.yml no levantó en el entorno de esta sesión — ver
 * reporte de @QA). `unwrap()` es deliberadamente defensivo (Array.isArray +
 * fallbacks) para tolerar variaciones menores del envelope de error sin
 * romper toda la spec; si algo no calza, las specs quedan legibles/
 * depurables porque `errorMessage`/`data` nunca son `undefined` silencioso.
 */
import type { APIRequestContext, Response as PageResponse } from "@playwright/test";

interface TrpcErrorShape {
  message: string;
  code?: number;
  data?: { code?: string; httpStatus?: number; path?: string };
}

interface TrpcSuccessEnvelope<T> {
  result: { data: { json: T } | T };
}

interface TrpcErrorEnvelope {
  error: TrpcErrorShape;
}

type TrpcEnvelope<T> = TrpcSuccessEnvelope<T> | TrpcErrorEnvelope | Record<string, never>;

export interface TrpcCallResult<T> {
  status: number;
  ok: boolean;
  /** `.json` ya desempaquetado — null si la llamada fue rechazada. */
  data: T | null;
  /** Mensaje de error tRPC (p. ej. "PRECONDITION_FAILED: ...") — null si ok. */
  errorMessage: string | null;
  errorCode: string | null;
}

function unwrap<T>(rawBody: unknown, ok: boolean): TrpcCallResult<T> {
  // Batch (UI real, httpBatchLink) → array de envelopes; toma el primero
  // (este helper siempre lee la respuesta de UNA llamada). No-batch (este
  // archivo) → ya es el envelope único.
  const body = (Array.isArray(rawBody) ? rawBody[0] : rawBody) as TrpcEnvelope<T> | undefined;

  if (!ok || !body || "error" in body) {
    // Defensivo: el shape exacto de `error` varía según si el server lo
    // corre por el transformer o no (no verificado contra server real —
    // ver nota de cabecera). Se prueban las 2 formas vistas en el repo.
    const errAny = body && "error" in body ? (body.error as unknown as Record<string, unknown>) : undefined;
    const nested = errAny?.["json"] as Record<string, unknown> | undefined;
    const message =
      (errAny?.["message"] as string | undefined) ?? (nested?.["message"] as string | undefined) ?? null;
    const dataField = (errAny?.["data"] as Record<string, unknown> | undefined) ??
      (nested?.["data"] as Record<string, unknown> | undefined);
    return {
      status: 0, // el caller sobreescribe status.
      ok: false,
      data: null,
      errorMessage: message ?? "Error tRPC sin mensaje (envelope inesperado — ver body crudo en el test).",
      errorCode: (dataField?.["code"] as string | undefined) ?? null,
    };
  }
  const raw = "result" in body ? body.result.data : undefined;
  const json = raw && typeof raw === "object" && "json" in (raw as object) ? (raw as { json: T }).json : (raw as T);
  return { status: 0, ok: true, data: json ?? null, errorMessage: null, errorCode: null };
}

/** Query GET — `input` se omite del querystring cuando es `undefined` (procedures sin input). */
export async function trpcQuery<T = unknown>(
  requestCtx: APIRequestContext,
  path: string,
  input?: unknown,
): Promise<TrpcCallResult<T>> {
  const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await requestCtx.get(`/api/trpc/${path}${qs}`);
  const body: unknown = await res.json().catch(() => ({}));
  const result = unwrap<T>(body, res.ok());
  return { ...result, status: res.status() };
}

/** Mutation POST — body = `{ json: input }` (envelope superjson no bacheado). */
export async function trpcMutate<T = unknown>(
  requestCtx: APIRequestContext,
  path: string,
  input: unknown,
): Promise<TrpcCallResult<T>> {
  const res = await requestCtx.post(`/api/trpc/${path}`, { data: { json: input } });
  const body: unknown = await res.json().catch(() => ({}));
  const result = unwrap<T>(body, res.ok());
  return { ...result, status: res.status() };
}

/**
 * Decodifica la respuesta de una mutación capturada con `page.waitForResponse`
 * — usado para leer el `cargo` que devuelve `dispensation.reserveItem` justo
 * después de la acción real de UI (Validar y reservar), sin otra llamada.
 */
export async function parseTrpcResponse<T = unknown>(response: PageResponse): Promise<TrpcCallResult<T>> {
  const body: unknown = await response.json().catch(() => ({}));
  const result = unwrap<T>(body, response.ok());
  return { ...result, status: response.status() };
}

/** Coerce un campo Decimal-como-string (ver nota de cabecera) a number. Null-safe. */
export function decimalToNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
