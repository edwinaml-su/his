/**
 * GET /api/admin/odoo/introspect
 *
 * Introspecta el esquema de `res.partner` en Odoo para diseñar el shape del
 * paciente en el HIS local. **Estrictamente READ-ONLY**:
 *
 *   1. `res.partner.fields_get` — metadata de TODOS los campos (tipo, label,
 *      required, ayuda). Devuelve un objeto `Record<fieldName, FieldMeta>`.
 *   2. `res.partner.search_read([], all_fields, 0, 3)` — 3 partners de muestra
 *      para validar shape real con datos vivos.
 *   3. `getOdooVersion()` — versión del servidor para audit.
 *
 * El endpoint NUNCA escribe, NUNCA llama `create`/`write`/`unlink`. La
 * directiva del proyecto es leer la estructura UNA VEZ y replicar campos
 * como columnas/tablas en el HIS — Odoo sigue siendo la fuente legacy pero
 * los datos del paciente operativo viven en el HIS.
 *
 * Restringido a rol ADMIN o DIRECTOR del tenant activo.
 *
 * Cuerpo retornado (~50-500 KB según riqueza del schema Odoo):
 *   { ok: true, version: {...}, fieldCount, fields: {...}, samples: [...] }
 */
import { NextResponse } from "next/server";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";
import { getOdooClient, getOdooVersion } from "@his/infrastructure";

// Node runtime: xmlrpc requiere fetch + XML parsing intensivo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roles autorizados (siempre normalizados a uppercase para evitar drift).
const ALLOWED_ROLES = new Set(["ADMIN", "DIRECTOR", "DIR"]);

interface OdooFieldMeta {
  string?: string; // label legible
  type?: string; // char, integer, many2one, many2many, one2many, selection, ...
  required?: boolean;
  readonly?: boolean;
  help?: string;
  relation?: string; // modelo destino si es many2one/many2many/one2many
  selection?: Array<[string, string]>; // opciones si es selection
  size?: number;
  store?: boolean;
  [k: string]: unknown;
}

export async function GET() {
  // 1) Auth + autorización.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "no autenticado" }, { status: 401 });
  }
  const tenant = await getTenantContext();
  if (!tenant) {
    return NextResponse.json(
      { ok: false, error: "sin organización activa" },
      { status: 401 },
    );
  }
  if (!tenant.roleCodes.some((r) => ALLOWED_ROLES.has(r.toUpperCase()))) {
    return NextResponse.json(
      { ok: false, error: "acceso restringido a ADMIN / DIRECTOR" },
      { status: 403 },
    );
  }

  // 2) Llamadas a Odoo (READ-ONLY).
  try {
    const version = await getOdooVersion();
    const odoo = await getOdooClient();

    // fields_get devuelve metadata de cada campo. Sin filtros = todos.
    const fields = await odoo.call<Record<string, OdooFieldMeta>>(
      "res.partner",
      "fields_get",
      [],
      // attributes limita la metadata devuelta; aceptamos lo relevante.
      {
        attributes: [
          "string",
          "type",
          "required",
          "readonly",
          "help",
          "relation",
          "selection",
          "size",
          "store",
        ],
      },
    );

    // Lista de nombres de campo para el search_read de samples.
    // Filtramos campos computed sin store (los que devuelven undefined siempre).
    const fieldNames = Object.entries(fields)
      .filter(([, meta]) => meta.store !== false)
      .map(([name]) => name);

    // 3 partners aleatorios — sin filtro de dominio, orden por id descendente
    // para obtener los más recientes.
    const samples = await odoo.searchRead<Record<string, unknown>>(
      "res.partner",
      [],
      fieldNames,
      0,
      3,
      "id desc",
    );

    // Resumen por tipo para que el caller (humano) tenga overview rápida.
    const fieldsByType: Record<string, number> = {};
    for (const meta of Object.values(fields)) {
      const t = String(meta.type ?? "unknown");
      fieldsByType[t] = (fieldsByType[t] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      version: {
        server_version: version.server_version,
        protocol_version: version.protocol_version,
      },
      uid: odoo.uid,
      db: odoo.config.db,
      url: odoo.config.url,
      model: "res.partner",
      fieldCount: Object.keys(fields).length,
      fieldsByType,
      fields,
      samples,
      generatedAt: new Date().toISOString(),
      generatedBy: { id: user.id, email: user.email },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Sanitiza password si por algún motivo aparece en el mensaje del error.
    const safe = message.replace(/password=[^&\s]+/gi, "password=***");
    return NextResponse.json({ ok: false, error: safe }, { status: 502 });
  }
}
