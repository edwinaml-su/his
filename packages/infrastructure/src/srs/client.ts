/**
 * Cliente SRS (Superintendencia de Regulación Sanitaria — El Salvador).
 *
 * Consulta read-only del padrón público de registro sanitario de medicamentos
 * en https://expedientes.srs.gob.sv/.
 *
 * NO hay API oficial documentada. Endpoints descubiertos por inspección del
 * HTML/JS del buscador público. Sujeto a cambios sin previo aviso por SRS.
 *
 * Spec completa: docs/35_integracion_srs_registro_sanitario.md
 *
 * Endpoints:
 *   - GET /productos/lista?filtro=&busqueda=&estado=&draw=&start=&length=
 *   - GET /productos/infogeneral?param={registroSanitario}
 */

const SRS_BASE_URL = process.env.SRS_BASE_URL ?? "https://expedientes.srs.gob.sv";
const FETCH_TIMEOUT_MS = Number(process.env.SRS_FETCH_TIMEOUT_MS ?? 20_000);

export type SrsFiltroBusqueda = "nombre_comercial" | "id_producto" | "principio_activo";
export type SrsEstado = "ACTIVO" | "CANCELADO" | "SUSPENDIDO" | "ELIMINADO";

export interface SrsListadoItem {
  idProducto: string;
  registroSanitario: string;
  nombreRegistro: string;
  vidaUtil: string | null;
  viaAdministracion: string | null;
  categoria: string | null;
  clasificacion: string | null;
  estado: SrsEstado;
  titular: string | null;
  condicionesAlmacenamiento: string | null;
  indicacionesTerapeuticas: string | null;
  primeraAutorizacion: string | null;
  anualidad: string | null;
  modalidadVenta: string | null;
  /** URLs extraídas del HTML `pdf` raw. */
  fichaTecnicaUrl: string | null;
  expedienteUrl: string | null;
  informeEvaluacionUrl: string | null;
}

export interface SrsListadoResult {
  recordsTotal: number;
  recordsFiltered: number;
  data: SrsListadoItem[];
}

export interface SrsPrincipioActivo {
  nombrePrincipioActivo: string;
  concentracion: string | null;
  unidadMedida: string | null;
}

export interface SrsFabricante {
  idFabricanteSrs: string | null;
  nombreFabricante: string;
  paisFabricante: string | null;
  tipo: "FABRICANTE" | "ACONDICIONADOR";
  renovacion: string | null;
}

export interface SrsPresentacion {
  codigoPresentacion: string | null;
  nombrePresentacion: string;
}

export interface SrsDetalle extends SrsListadoItem {
  mecanismoAccion: string | null;
  regimenDosificacion: string | null;
  farmacocinetica: string | null;
  efectosAdversos: string | null;
  contraindicaciones: string | null;
  precauciones: string | null;
  principalesInteracciones: string | null;
  principiosActivos: SrsPrincipioActivo[];
  formasFarmaceuticas: string[];
  fabricantes: SrsFabricante[];
  presentaciones: SrsPresentacion[];
  /** Snapshot raw del JSON SRS para auditoría. */
  rawPayload: Record<string, unknown>;
}

interface SrsListadoRawItem {
  idProducto: string;
  registroSanitario: string;
  nombreRegistro: string;
  vidaUtil: string | null;
  viaAdministracion: string | null;
  categoria: string | null;
  clasificacion: string | null;
  estado: string;
  titular: string | null;
  condicionesAlmacenamiento: string | null;
  indicacionesTerapeuticas: string | null;
  primeraAutorizacion: string | null;
  anualidad: string | null;
  modalidadVenta: string | null;
  pdf: string;
}

interface SrsInfoGeneralRaw {
  status: number;
  data: {
    registroSanitario: string;
    nombreRegistro: string;
    anualidad: string | null;
    vidaUtil: string | null;
    viaAdministracion: string | null;
    categoria: string | null;
    estado: string;
    titular: string | null;
    condicionesAlmacenamiento: string | null;
    INDICACIONES_TERAPEUTICAS?: string | null;
    MECANISMO_ACCION?: string | null;
    REGIMEN_DOSIFICACION?: string | null;
    FARMACOCINETICA?: string | null;
    EFECTOS_ADVERSOS?: string | null;
    CONTRAINDICACIONES?: string | null;
    PRECAUCIONES?: string | null;
    PRINCIPALES_INTERACCIONES?: string | null;
    PA?: Array<{
      nombrePrincipioActivo: string;
      nombreUnidadMedida: string | null;
      concentracion: string | null;
    }>;
    formafarm?: Array<{ nombreFormaFarmaceutica: string }>;
    fabricantes?: Array<{
      idFabricante: string | null;
      nombreFabricante: string;
      paisFabricante: string | null;
      tipo: string;
      renovacion: string | null;
    }>;
    labsAcondi?: Array<{
      nombreFabricante: string;
      paisFabricante: string | null;
    }>;
    presentaciones?: Array<{
      codigoPresentacion?: string | null;
      nombrePresentacion: string;
    }>;
    [key: string]: unknown;
  };
}

/** Extrae los 3 hrefs (ficha/expediente/informe) del HTML del campo `pdf`. */
function parsePdfUrls(htmlPdf: string): {
  fichaTecnicaUrl: string | null;
  expedienteUrl: string | null;
  informeEvaluacionUrl: string | null;
} {
  const out = {
    fichaTecnicaUrl: null as string | null,
    expedienteUrl: null as string | null,
    informeEvaluacionUrl: null as string | null,
  };
  if (!htmlPdf) return out;

  const hrefRegex = /href="([^"]+)"/g;
  const hrefs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = hrefRegex.exec(htmlPdf)) !== null) {
    hrefs.push(m[1]!.replace(/\\\//g, "/"));
  }

  for (const url of hrefs) {
    if (url.includes("/productos/consultarficha")) out.fichaTecnicaUrl = url;
    else if (url.includes("/productos/detalles/pdf")) out.expedienteUrl = url;
    else if (url.includes("/productos/informeevaluacion")) out.informeEvaluacionUrl = url;
  }
  return out;
}

function normalizeEstado(raw: string | null | undefined): SrsEstado {
  const v = (raw ?? "").toUpperCase();
  if (v === "ACTIVO" || v === "CANCELADO" || v === "SUSPENDIDO" || v === "ELIMINADO") return v;
  return "ELIMINADO";
}

function normalizeListadoItem(raw: SrsListadoRawItem): SrsListadoItem {
  const urls = parsePdfUrls(raw.pdf ?? "");
  return {
    idProducto: raw.idProducto,
    registroSanitario: raw.registroSanitario,
    nombreRegistro: raw.nombreRegistro,
    vidaUtil: raw.vidaUtil,
    viaAdministracion: raw.viaAdministracion,
    categoria: raw.categoria,
    clasificacion: raw.clasificacion,
    estado: normalizeEstado(raw.estado),
    titular: raw.titular,
    condicionesAlmacenamiento: raw.condicionesAlmacenamiento,
    indicacionesTerapeuticas: raw.indicacionesTerapeuticas,
    primeraAutorizacion: raw.primeraAutorizacion,
    anualidad: raw.anualidad,
    modalidadVenta: raw.modalidadVenta,
    ...urls,
  };
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Buscador principal. Pagina al estilo DataTables. */
export async function buscarPadron(args: {
  filtro: SrsFiltroBusqueda;
  busqueda: string;
  estado?: SrsEstado | "";
  start?: number;
  length?: number;
}): Promise<SrsListadoResult> {
  const qs = new URLSearchParams({
    filtro: args.filtro,
    busqueda: args.busqueda,
    estado: args.estado ?? "",
    draw: "1",
    start: String(args.start ?? 0),
    length: String(args.length ?? 25),
  });
  const url = `${SRS_BASE_URL}/productos/lista?${qs.toString()}`;
  const res = await fetchWithTimeout(url, {
    headers: { Accept: "application/json", "User-Agent": "HIS-Avante/1.0" },
  });
  if (!res.ok) {
    throw new Error(`SRS /productos/lista respondió ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    recordsTotal: number;
    recordsFiltered: number;
    data: SrsListadoRawItem[];
  };
  return {
    recordsTotal: json.recordsTotal,
    recordsFiltered: json.recordsFiltered,
    data: (json.data ?? []).map(normalizeListadoItem),
  };
}

/** Detalle de un registro por número de registro sanitario. */
export async function obtenerDetalle(registroSanitario: string): Promise<SrsDetalle> {
  const url = `${SRS_BASE_URL}/productos/infogeneral?param=${encodeURIComponent(registroSanitario)}`;
  const res = await fetchWithTimeout(url, {
    headers: { Accept: "application/json", "User-Agent": "HIS-Avante/1.0" },
  });
  if (!res.ok) {
    throw new Error(`SRS /productos/infogeneral respondió ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as SrsInfoGeneralRaw;
  if (json.status !== 200) {
    throw new Error(`SRS detalle status=${json.status} para ${registroSanitario}`);
  }
  const d = json.data;

  const principiosActivos: SrsPrincipioActivo[] = (d.PA ?? []).map((p) => ({
    nombrePrincipioActivo: p.nombrePrincipioActivo,
    concentracion: p.concentracion,
    unidadMedida: p.nombreUnidadMedida,
  }));

  const formasFarmaceuticas: string[] = (d.formafarm ?? []).map((f) => f.nombreFormaFarmaceutica);

  const fabricantesPrincipales: SrsFabricante[] = (d.fabricantes ?? []).map((f) => ({
    idFabricanteSrs: f.idFabricante,
    nombreFabricante: f.nombreFabricante,
    paisFabricante: f.paisFabricante,
    tipo: "FABRICANTE",
    renovacion: f.renovacion,
  }));

  const acondicionadores: SrsFabricante[] = (d.labsAcondi ?? []).map((f) => ({
    idFabricanteSrs: null,
    nombreFabricante: f.nombreFabricante,
    paisFabricante: f.paisFabricante,
    tipo: "ACONDICIONADOR",
    renovacion: null,
  }));

  const presentaciones: SrsPresentacion[] = (d.presentaciones ?? []).map((p) => ({
    codigoPresentacion: p.codigoPresentacion ?? null,
    nombrePresentacion: p.nombrePresentacion,
  }));

  // Detalle también puede traer datos del listado — completar con shape común.
  // La modalidad de venta y URLs PDF típicamente no vienen en infogeneral —
  // se recuperan vía buscarPadron previo. Aceptamos null como fallback.
  return {
    idProducto: (d.idProducto as string | undefined) ?? "",
    registroSanitario: d.registroSanitario,
    nombreRegistro: d.nombreRegistro,
    vidaUtil: d.vidaUtil,
    viaAdministracion: d.viaAdministracion,
    categoria: d.categoria,
    clasificacion: (d.clasificacion as string | null | undefined) ?? null,
    estado: normalizeEstado(d.estado),
    titular: d.titular,
    condicionesAlmacenamiento: d.condicionesAlmacenamiento,
    indicacionesTerapeuticas: d.INDICACIONES_TERAPEUTICAS ?? null,
    primeraAutorizacion: (d.primeraAutorizacion as string | null | undefined) ?? null,
    anualidad: d.anualidad,
    modalidadVenta: (d.modalidadVenta as string | null | undefined) ?? null,
    mecanismoAccion: d.MECANISMO_ACCION ?? null,
    regimenDosificacion: d.REGIMEN_DOSIFICACION ?? null,
    farmacocinetica: d.FARMACOCINETICA ?? null,
    efectosAdversos: d.EFECTOS_ADVERSOS ?? null,
    contraindicaciones: d.CONTRAINDICACIONES ?? null,
    precauciones: d.PRECAUCIONES ?? null,
    principalesInteracciones: d.PRINCIPALES_INTERACCIONES ?? null,
    principiosActivos,
    formasFarmaceuticas,
    fabricantes: [...fabricantesPrincipales, ...acondicionadores],
    presentaciones,
    fichaTecnicaUrl: null,
    expedienteUrl: null,
    informeEvaluacionUrl: null,
    rawPayload: d as Record<string, unknown>,
  };
}

/** Parse de "24 MESES" / "2 AÑOS" / "36 MESES" → meses. Devuelve null si no parsea. */
export function parseVidaUtilMeses(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const t = texto.toUpperCase().trim();
  const m = t.match(/^(\d+)\s*(MESES?|A[ÑN]OS?)/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (!Number.isFinite(n)) return null;
  return m[2]!.startsWith("A") ? n * 12 : n;
}
