/**
 * POST /api/sync/replay
 *
 * Endpoint idempotente que procesa mutations offline encoladas en el cliente.
 * Recibe un item de la sync_queue y lo ejecuta en el servidor.
 *
 * Idempotencia: el `id_local` (UUID cliente) se usa para detectar duplicados.
 * Si ya existe en `OfflineSyncLog`, retorna 200 indicando ya procesado.
 *
 * Conflict detection: si la indicación ya fue administrada (status DONE),
 * retorna 409 para que el cliente lo marque como conflicto de resolución manual.
 *
 * Auth: requiere sesión Supabase válida (cookie his.session).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReplayItemSchema = z.object({
  id_local: z.string().uuid(),
  tipo: z.enum(["validate5Correctos", "administrationRecord", "statOverride"]),
  payload: z.unknown(),
  created_at: z.number(),
});

type ReplayItem = z.infer<typeof ReplayItemSchema>;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth check
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // 2. Parse body
  let item: ReplayItem;
  try {
    const body = await req.json();
    item = ReplayItemSchema.parse(body);
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  // 3. Idempotency check — busca si id_local ya fue procesado
  const { data: existing } = await supabase
    .from("offline_sync_log")
    .select("id_local, processed_at")
    .eq("id_local", item.id_local)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      status: "already_processed",
      id_local: item.id_local,
      processed_at: existing.processed_at,
    });
  }

  // 4. Procesar según tipo
  try {
    const result = await processReplayItem(item, user.id, supabase);

    // 5. Registrar en log idempotente
    await supabase.from("offline_sync_log").insert({
      id_local: item.id_local,
      user_id: user.id,
      tipo: item.tipo,
      created_at_client: new Date(item.created_at).toISOString(),
      processed_at: new Date().toISOString(),
      result: result,
    });

    return NextResponse.json({ status: "ok", id_local: item.id_local, result });
  } catch (err) {
    if (err instanceof ConflictError) {
      return NextResponse.json(
        { error: "conflict", message: err.message, id_local: item.id_local },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

async function processReplayItem(
  item: ReplayItem,
  userId: string,
  supabase: SupabaseClient,
): Promise<unknown> {
  switch (item.tipo) {
    case "administrationRecord": {
      return processAdministrationRecord(item.payload, userId, supabase);
    }
    case "validate5Correctos": {
      // Validaciones offline son read-only en server — solo se persiste el log
      return { logged: true, tipo: "validate5Correctos" };
    }
    case "statOverride": {
      return processStatOverride(item.payload, userId, supabase);
    }
  }
}

async function processAdministrationRecord(
  payload: unknown,
  userId: string,
  supabase: SupabaseClient,
): Promise<unknown> {
  const schema = z.object({
    indicationId: z.string().uuid(),
    patientId: z.string().uuid(),
    gtin: z.string(),
    administeredAt: z.string().datetime(),
    notes: z.string().optional(),
  });

  const data = schema.parse(payload);

  // Conflict check: ¿ya fue administrada esta indicación?
  const { data: existing } = await supabase
    .from("MedicationAdministration")
    .select("id, status")
    .eq("medicationOrderId", data.indicationId)
    .eq("status", "COMPLETED")
    .maybeSingle();

  if (existing) {
    throw new ConflictError(
      `Indicación ${data.indicationId} ya fue administrada (id: ${existing.id})`,
    );
  }

  // Insertar registro de administración
  const { data: inserted, error } = await supabase
    .from("MedicationAdministration")
    .insert({
      medicationOrderId: data.indicationId,
      patientId: data.patientId,
      administeredBy: userId,
      administeredAt: data.administeredAt,
      status: "COMPLETED",
      notes: data.notes ?? null,
      source: "OFFLINE_SYNC",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return { administrationId: inserted.id };
}

async function processStatOverride(
  payload: unknown,
  userId: string,
  supabase: SupabaseClient,
): Promise<unknown> {
  const schema = z.object({
    indicationId: z.string().uuid(),
    reason: z.string().min(1),
    authorizedBy: z.string().uuid().optional(),
  });

  const data = schema.parse(payload);

  const { data: inserted, error } = await supabase
    .from("ClinicalOverride")
    .insert({
      medicationOrderId: data.indicationId,
      overriddenBy: userId,
      reason: data.reason,
      authorizedBy: data.authorizedBy ?? userId,
      source: "OFFLINE_SYNC",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return { overrideId: inserted.id };
}
