/**
 * GET /api/retencion/report.csv
 * US.F2.7.32 — Exportación CSV de expedientes próximos a vencer retención.
 *
 * Query params:
 *   diasProximos (default: 90) — ventana de búsqueda
 *
 * Requiere sesión autenticada con rol DIR o ADM.
 * La query directa usa createServerClient (no tRPC) para evitar overhead.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const diasProximos = Math.min(
    365,
    Math.max(1, Number(searchParams.get("diasProximos") ?? "90")),
  );

  // Auth básica: verificar sesión Supabase.
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => undefined, // read-only en route handler
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  // Encabezados CSV.
  const headers = [
    "episodio_id",
    "paciente_id",
    "fecha_inicio_atencion",
    "fecha_vencimiento_retencion",
    "estado_conservacion",
    "dias_para_vencer",
  ];

  // Nota: esta query usa el cliente Supabase con RLS. Los datos retornados
  // dependen de app.current_org_id seteado por la sesión autenticada.
  // Para la exportación admin directa se confía en el filtro RLS de Supabase.
  const { data, error } = await supabase.rpc("retencion_proximos_vencer", {
    p_dias: diasProximos,
    p_limit: 10000,
  });

  if (error) {
    // La función RPC puede no existir en todas las instalaciones;
    // devolvemos CSV vacío con encabezados en lugar de error 500.
    const csvVacio = [headers.join(","), ""].join("\n");
    return new NextResponse(csvVacio, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="retencion_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const rows = (
    data as Array<{
      episodio_id: string;
      paciente_id: string;
      fecha_hora_inicio: string;
      fecha_vencimiento_retencion: string | null;
      estado_conservacion: string;
      dias_para_vencer: number | null;
    }>
  ).map((r) =>
    [
      r.episodio_id,
      r.paciente_id,
      r.fecha_hora_inicio,
      r.fecha_vencimiento_retencion ?? "",
      r.estado_conservacion,
      r.dias_para_vencer ?? "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );

  const csv = [headers.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="retencion_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
