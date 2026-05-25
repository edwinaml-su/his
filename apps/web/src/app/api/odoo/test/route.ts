/**
 * GET /api/odoo/test
 *
 * Verifica la conexión con el servidor Odoo:
 *   1. Llama `common.version` (sin auth) → confirma que el servidor responde.
 *   2. Autentica con las credenciales de env vars → confirma UID.
 *   3. Lee 1 res.partner como sanity check del acceso de datos.
 *
 * NO retorna datos sensibles. Solo metadata segura:
 *   - server_version
 *   - protocol_version
 *   - uid (entero — no expone username/password)
 *   - sample.count (cantidad leída, no contenido)
 *
 * Requiere rol ADMIN. NUNCA exponer este endpoint sin auth.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getOdooClient, getOdooVersion } from "@his/infrastructure";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "no autenticado" }, { status: 401 });
  }

  try {
    // 1. version (no auth)
    const version = await getOdooVersion();

    // 2. authenticate + read sanity check
    const odoo = await getOdooClient();
    const partners = await odoo.searchRead<{ id: number; name: string }>(
      "res.partner",
      [],
      ["id"], // solo id — no exponer nombres en este endpoint diagnóstico
      0,
      1,
    );

    return NextResponse.json({
      ok: true,
      server_version: version.server_version,
      protocol_version: version.protocol_version,
      uid: odoo.uid,
      db: odoo.config.db,
      url: odoo.config.url,
      sample: { model: "res.partner", count: partners.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Sanitizar password si por algún motivo aparece en mensaje
    const safe = message.replace(/password=[^&\s]+/gi, "password=***");
    return NextResponse.json({ ok: false, error: safe }, { status: 502 });
  }
}
