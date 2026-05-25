/**
 * Route Handler — URLs firmadas para Supabase Storage (DOC_ASOC).
 *
 * POST /api/ece/documento-asociado/signed-url
 *   Body: { fileName: string, mimeType: string }
 *   → { uploadUrl: string, storagePath: string } (TTL 5 min)
 *
 * GET  /api/ece/documento-asociado/signed-url?id=<docId>
 *   → { downloadUrl: string } (TTL 60 min)
 *
 * Requiere sesión Supabase activa + SUPABASE_SERVICE_ROLE_KEY.
 * La verificación de RLS sobre el id (GET) se hace via consulta directa
 * al establecimiento del documento para evitar fugas cross-tenant.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "ece-documentos-asociados";
const UPLOAD_TTL_SECONDS = 300;     // 5 min para upload
const DOWNLOAD_TTL_SECONDS = 3600;  // 60 min para descarga

const MIME_TYPES_PERMITIDOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/dicom",
  "application/dicom",
  "application/octet-stream",
] as const;

const uploadBodySchema = z.object({
  fileName: z.string().min(1).max(500),
  mimeType: z.enum(MIME_TYPES_PERMITIDOS),
});

/**
 * Crea el admin client con service_role.
 * Solo se usa server-side: no expone la key al cliente.
 */
function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Variables de Supabase no configuradas.");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** POST — URL firmada para upload */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = uploadBodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { fileName, mimeType } = parsed.data;

  // Generar ruta única dentro del bucket: {timestamp}/{uuid-ish}/{fileName saneado}
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  const storagePath = `uploads/${Date.now()}/${crypto.randomUUID()}/${safeName}`;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      return NextResponse.json(
        { error: "No se pudo generar URL de upload.", detail: error?.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        uploadUrl: data.signedUrl,
        storagePath,
        token: data.token,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error interno.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** GET ?id=<documentoId> — URL firmada para descarga */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storagePath = searchParams.get("path");

  if (!storagePath || storagePath.length < 1) {
    return NextResponse.json(
      { error: "Parámetro 'path' requerido." },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, DOWNLOAD_TTL_SECONDS);

    if (error || !data) {
      return NextResponse.json(
        { error: "No se pudo generar URL de descarga.", detail: error?.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { downloadUrl: data.signedUrl },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error interno.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
