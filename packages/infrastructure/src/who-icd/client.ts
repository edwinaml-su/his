/**
 * Cliente WHO ICD-11 (CIE-11) — búsqueda de diagnósticos para la ECE.
 *
 * Fuente de verdad del catálogo CIE-11 (CC-0001 RF-03 / RN-02). La app NO
 * almacena el catálogo completo; consulta la API de la OMS en vivo y persiste
 * solo el {codigo, descripcion} elegido dentro del diagnóstico de la HC.
 *
 * Dos modos de despliegue:
 *   1. Cloud (default): https://id.who.int  — requiere OAuth2 client_credentials.
 *      Registro gratuito en https://icd.who.int/icdapi → WHO_ICD_CLIENT_ID/SECRET.
 *   2. Self-host: contenedor `who/icd-docker` local → WHO_ICD_API_BASE
 *      (ej. http://localhost:8382). Normalmente sin OAuth.
 *
 * Variables de entorno:
 *   WHO_ICD_CLIENT_ID      client_id OAuth2 (modo cloud).
 *   WHO_ICD_CLIENT_SECRET  client_secret OAuth2 (modo cloud).
 *   WHO_ICD_API_BASE       base URL alterna (modo self-host). Opcional.
 *   WHO_ICD_TOKEN_URL      endpoint de token. Default icdaccessmanagement.who.int.
 *   WHO_ICD_RELEASE        release de la linearización MMS. Default "2024-01".
 *   WHO_ICD_LANGUAGE       Accept-Language. Default "es".
 *
 * El secreto NUNCA llega al browser: este cliente corre server-side y se expone
 * vía el router tRPC `cie11.buscar`. Si no está configurado, el router degrada
 * a entrada manual (el formulario valida el código con CIE11_CODE_REGEX).
 */

const CLOUD_API_BASE = "https://id.who.int";
const TOKEN_URL =
  process.env.WHO_ICD_TOKEN_URL ?? "https://icdaccessmanagement.who.int/connect/token";
const RELEASE = process.env.WHO_ICD_RELEASE ?? "2024-01";
const LANGUAGE = process.env.WHO_ICD_LANGUAGE ?? "es";
const FETCH_TIMEOUT_MS = Number(process.env.WHO_ICD_FETCH_TIMEOUT_MS ?? 15_000);

export interface WhoIcdSearchItem {
  /** theCode de la entidad MMS (ej. "1A00", "BA00.0"). Puede ir vacío en agrupadores. */
  codigo: string;
  /** Título legible, sin marcado HTML. */
  titulo: string;
  /** URI de la entidad (id.who.int/...). Útil para postcoordinación futura. */
  uri: string;
}

export interface WhoIcdSearchResult {
  items: WhoIcdSearchItem[];
}

/** Se lanza cuando faltan credenciales/base — el router lo traduce a fallback manual. */
export class WhoIcdNotConfiguredError extends Error {
  constructor() {
    super(
      "WHO ICD-11 API no configurada (defina WHO_ICD_CLIENT_ID/SECRET o WHO_ICD_API_BASE).",
    );
    this.name = "WhoIcdNotConfiguredError";
  }
}

function selfHostBase(): string | null {
  const b = process.env.WHO_ICD_API_BASE?.trim();
  return b ? b.replace(/\/+$/, "") : null;
}

function hasCloudCreds(): boolean {
  return Boolean(process.env.WHO_ICD_CLIENT_ID && process.env.WHO_ICD_CLIENT_SECRET);
}

/** True si hay alguna ruta de acceso (cloud con creds o self-host). */
export function isWhoIcdConfigured(): boolean {
  return Boolean(selfHostBase()) || hasCloudCreds();
}

interface WhoSearchRaw {
  destinationEntities?: Array<{
    id?: string;
    title?: string;
    theCode?: string;
  }>;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Obtiene (y cachea ~1h) el bearer token OAuth2 client_credentials. */
async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const clientId = process.env.WHO_ICD_CLIENT_ID;
  const clientSecret = process.env.WHO_ICD_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new WhoIcdNotConfiguredError();

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "icdapi_access",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`WHO token endpoint respondió ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

/** Quita marcado HTML y decodifica las entidades comunes que devuelve la API. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Busca diagnósticos CIE-11 en la linearización MMS.
 * Lanza WhoIcdNotConfiguredError si no hay credenciales ni base self-host.
 */
export async function buscarCie11(
  query: string,
  opts: { limit?: number } = {},
): Promise<WhoIcdSearchResult> {
  const q = query.trim();
  if (!q) return { items: [] };
  if (!isWhoIcdConfigured()) throw new WhoIcdNotConfiguredError();

  const base = selfHostBase() ?? CLOUD_API_BASE;
  const qs = new URLSearchParams({
    q,
    flatResults: "true",
    useFlexisearch: "false",
    highlightingEnabled: "false",
  });
  const url = `${base}/icd/release/11/${RELEASE}/mms/search?${qs.toString()}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "API-Version": "v2",
    "Accept-Language": LANGUAGE,
  };
  // Cloud siempre requiere Bearer. Self-host solo si además hay creds declaradas.
  if (!selfHostBase() || hasCloudCreds()) {
    headers.Authorization = `Bearer ${await getToken()}`;
  }

  const res = await fetchWithTimeout(url, { headers });
  if (!res.ok) {
    throw new Error(`WHO ICD search respondió ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as WhoSearchRaw;
  const limit = opts.limit ?? 20;

  const items: WhoIcdSearchItem[] = (json.destinationEntities ?? [])
    .slice(0, limit)
    .map((e) => ({
      codigo: (e.theCode ?? "").toUpperCase(),
      titulo: stripHtml(e.title ?? ""),
      uri: e.id ?? "",
    }))
    .filter((it) => it.titulo.length > 0);

  return { items };
}
