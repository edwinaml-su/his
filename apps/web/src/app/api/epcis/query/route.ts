/**
 * EPCIS Query Interface REST — /api/epcis/query
 *
 * Compatible con EPCIS Query Interface 2.0 (GS1 EPCIS Standard 1.2 / 2.0).
 * Permite a auditores MINSAL consultar eventos EPCIS con filtros estándar.
 *
 * Autenticación: API key en header X-HIS-API-Key (admin only).
 * Rate limiting: 100 req/min por API key (middleware existente en next.config.mjs).
 *
 * GET /api/epcis/query?gtin=&lote=&gln=&from=&to=&format=json|xml
 *
 * US.F2.6.53, US.F2.6.58 — Sección 6 Épica E.F2.6
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Auth guard — API key de solo lectura para MINSAL/auditores
// ---------------------------------------------------------------------------

function validateApiKey(req: NextRequest): boolean {
  const key = req.headers.get("x-his-api-key");
  const expected = process.env.EPCIS_QUERY_API_KEY;
  if (!expected) return false;          // Sin variable configurada → deniega siempre
  return key === expected;
}

// ---------------------------------------------------------------------------
// Rate limiting básico (en memoria por proceso; el middleware de edge es el primario)
// ---------------------------------------------------------------------------

const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100;
const WINDOW_MS = 60_000;

function checkRateLimit(apiKey: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(apiKey);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(apiKey, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers de formato EPCIS
// ---------------------------------------------------------------------------

interface EpcisEventRaw {
  id: string;
  tipo_evento: string;
  subtipo: string;
  what: unknown;
  where_data: unknown;
  event_time: Date;
  record_time: Date;
  why: unknown;
  who: unknown;
  payload_hash: string;
  indication_id: string | null;
  establecimiento_id: string;
  status: string;
}

function toEpcisJsonEvent(row: EpcisEventRaw) {
  return {
    "@context": ["https://ref.gs1.org/standards/epcis/epcis-context.jsonld"],
    type: row.tipo_evento,
    eventID: `urn:uuid:${row.id}`,
    eventTime: (row.event_time instanceof Date ? row.event_time : new Date(row.event_time)).toISOString(),
    recordTime: (row.record_time instanceof Date ? row.record_time : new Date(row.record_time)).toISOString(),
    epcList: (row.what as Record<string, unknown>)?.epcList ?? [],
    action: "OBSERVE",
    bizStep: `urn:epcglobal:cbv:bizstep:${(row.why as Record<string, unknown>)?.businessStep ?? ""}`,
    disposition: `urn:epcglobal:cbv:disp:${(row.why as Record<string, unknown>)?.disposition ?? ""}`,
    readPoint: { id: (row.where_data as Record<string, unknown>)?.readPoint ?? "" },
    bizLocation: { id: (row.where_data as Record<string, unknown>)?.bizLocation ?? "" },
    bizTransactionList: (row.why as Record<string, unknown>)?.bizTransactionList ?? [],
    sourceList: (row.who as Record<string, unknown>)?.sourceList ?? [],
    destinationList: (row.who as Record<string, unknown>)?.destinationList ?? [],
    // Extensiones HIS
    his: {
      subtipo: row.subtipo,
      payloadHash: row.payload_hash,
      indicationId: row.indication_id,
      establecimientoId: row.establecimiento_id,
      status: row.status,
    },
  };
}

function toEpcisXml(events: ReturnType<typeof toEpcisJsonEvent>[]): string {
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<epcis:EPCISDocument xmlns:epcis="urn:epcglobal:epcis:xsd:1"
                     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                     schemaVersion="1.2"
                     creationDate="${new Date().toISOString()}">
  <EPCISHeader>
    <StandardBusinessDocumentHeader>
      <Sender>
        <Identifier Authority="EAN.UCC">7413000000001</Identifier>
        <ContactInformation>
          <Contact>HIS Multipaís — Inversiones Avante</Contact>
        </ContactInformation>
      </Sender>
    </StandardBusinessDocumentHeader>
  </EPCISHeader>
  <EPCISBody>
    <EventList>`;

  const eventsXml = events.map((e) => `
      <ObjectEvent>
        <eventTime>${e.eventTime}</eventTime>
        <recordTime>${e.recordTime}</recordTime>
        <eventID>${e.eventID}</eventID>
        <epcList>${(e.epcList as string[]).map((epc: string) => `<epc>${epc}</epc>`).join("")}</epcList>
        <action>OBSERVE</action>
        <bizStep>${e.bizStep}</bizStep>
        <disposition>${e.disposition}</disposition>
        <readPoint><id>${(e.readPoint as Record<string, string>).id}</id></readPoint>
        <bizLocation><id>${(e.bizLocation as Record<string, string>).id}</id></bizLocation>
      </ObjectEvent>`).join("");

  const footer = `
    </EventList>
  </EPCISBody>
</epcis:EPCISDocument>`;

  return header + eventsXml + footer;
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // Auth
  if (!validateApiKey(req)) {
    return NextResponse.json(
      { error: "Unauthorized", message: "API key inválida o ausente" },
      { status: 401 },
    );
  }

  const apiKey = req.headers.get("x-his-api-key")!;
  if (!checkRateLimit(apiKey)) {
    return NextResponse.json(
      { error: "TooManyRequests", message: "Límite de 100 req/min excedido" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { searchParams } = req.nextUrl;
  const gtin = searchParams.get("gtin");
  const lote = searchParams.get("lote");
  const gln = searchParams.get("gln");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const format = (searchParams.get("format") ?? "json").toLowerCase();

  // Construir query dinámica
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];
  let idx = 1;

  if (gtin) {
    conditions.push(`what->>'gtin' = $${idx++}`);
    params.push(gtin);
  }
  if (lote) {
    conditions.push(`what->>'lote' = $${idx++}`);
    params.push(lote);
  }
  if (gln) {
    // Busca en readPoint o bizLocation
    conditions.push(`(where_data->>'readPoint' LIKE $${idx} OR where_data->>'bizLocation' LIKE $${idx})`);
    params.push(`%${gln}%`);
    idx++;
  }
  if (from) {
    conditions.push(`event_time >= $${idx++}`);
    params.push(new Date(from));
  }
  if (to) {
    conditions.push(`event_time <= $${idx++}`);
    params.push(new Date(to));
  }

  // Límite de seguridad: máximo 1000 eventos por consulta
  params.push(1000);
  const sql = `
    SELECT id, tipo_evento, subtipo, what, where_data,
           event_time, record_time, why, who,
           payload_hash, indication_id, establecimiento_id, status
      FROM ece.gs1_epcis_event
     WHERE ${conditions.join(" AND ")}
     ORDER BY event_time DESC
     LIMIT $${idx}
  `;

  try {
    const { prisma } = await import("@his/database");
    const rows = await prisma.$queryRawUnsafe<EpcisEventRaw[]>(sql, ...params);
    const jsonEvents = rows.map(toEpcisJsonEvent);

    if (format === "xml") {
      return new NextResponse(toEpcisXml(jsonEvents), {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "X-Total-Count": String(jsonEvents.length),
        },
      });
    }

    // JSON-LD (EPCIS 2.0 estilo)
    return NextResponse.json(
      {
        "@context": "https://ref.gs1.org/standards/epcis/epcis-context.jsonld",
        type: "EPCISQueryDocument",
        schemaVersion: "2.0",
        creationDate: new Date().toISOString(),
        epcisBody: {
          queryResults: {
            queryName: "SimpleEventQuery",
            resultsBody: {
              EventList: jsonEvents,
            },
          },
        },
        _meta: {
          totalEvents: jsonEvents.length,
          query: { gtin, lote, gln, from, to },
        },
      },
      {
        headers: {
          "X-Total-Count": String(jsonEvents.length),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    console.error("[EPCIS query]", err);
    return NextResponse.json(
      { error: "InternalError", message: "Error consultando eventos EPCIS" },
      { status: 500 },
    );
  }
}
