/**
 * Tools del Avante Asistente — Fase 3.
 *
 * El modelo decide cuándo invocar cada tool según la pregunta del usuario.
 * Las tools son **read-only** (sin mutaciones destructivas) y siempre
 * tenant-scoped vía `organizationId` que viaja en el context del cliente.
 *
 * Catálogo:
 *   - searchPatient: busca pacientes por MRN, nombre o DUI.
 *   - getMyPatientsAsPhysician: para médicos, lista sus pacientes referidos.
 *   - suggestNavigation: el bot propone una URL; el cliente la renderiza
 *     como botón "Ir ahí" (NO navega automático — confirmación humana).
 *
 * Seguridad: las queries server-side usan SERVICE_ROLE_KEY contra Supabase,
 * pero **siempre** filtran por `organizationId` para mantener tenant isolation.
 * Sin un `organizationId` válido, las tools devuelven [] o error.
 */
import { tool } from "ai";
import { z } from "zod";

interface ToolAuthContext {
  userId?: string;
  organizationId?: string;
  roleCodes?: string[];
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Llama PostgREST en read-only con timeout. */
async function rpcQuery<T = unknown>(
  pathAndQuery: string,
  signal?: AbortSignal,
): Promise<T[]> {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase no configurado (URL/KEY).");
  }
  const res = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    method: "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostgREST ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool: searchPatient
// ─────────────────────────────────────────────────────────────────────────────

interface PatientRow {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  active: boolean;
}

export function buildTools(auth: ToolAuthContext) {
  return {
    searchPatient: tool({
      description:
        "Busca pacientes del tenant del usuario por MRN, nombre o apellido. " +
        "Devuelve hasta 10 resultados con ID, MRN, nombre completo y fecha de nacimiento. " +
        "Útil cuando el usuario menciona un nombre o expediente y quiere encontrar al paciente.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .max(100)
          .describe(
            "Texto a buscar — puede ser parte de MRN, firstName, lastName o DUI. Mínimo 2 caracteres.",
          ),
      }),
      execute: async ({ query }) => {
        if (!auth.organizationId) {
          return { error: "Sin organización activa — el usuario debe seleccionar tenant." };
        }
        const pattern = `%${query.replace(/[%_]/g, "")}%`;
        const orgFilter = `eq.${auth.organizationId}`;
        try {
          // Búsqueda OR sobre 3 columnas vía PostgREST.
          const url = `Patient?select=id,mrn,firstName,lastName,birthDate,active&organizationId=${orgFilter}&active=eq.true&or=(mrn.ilike.${encodeURIComponent(pattern)},firstName.ilike.${encodeURIComponent(pattern)},lastName.ilike.${encodeURIComponent(pattern)})&limit=10`;
          const rows = await rpcQuery<PatientRow>(url);
          return {
            count: rows.length,
            patients: rows.map((r) => ({
              id: r.id,
              mrn: r.mrn,
              name: `${r.firstName} ${r.lastName}`,
              birthDate: r.birthDate,
              detailUrl: `/patients/${r.id}`,
            })),
          };
        } catch (err) {
          return {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    }),

    getMyPatientsAsPhysician: tool({
      description:
        "Lista los pacientes que el usuario médico ha atendido (modelo B2B2C). " +
        "Solo aplica si el usuario tiene rol PHYSICIAN, ANEST, GO, PEDIA. " +
        "Devuelve hasta 10 pacientes con conteos por tipo de encuentro y última atención. " +
        "Útil cuando el médico pregunta '¿qué pacientes tengo?' o '¿cuáles fueron mis casos?'.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe("Máximo de pacientes a devolver (default 10)."),
      }),
      execute: async ({ limit }) => {
        if (!auth.userId || !auth.organizationId) {
          return { error: "Sin contexto de usuario/organización." };
        }
        const physicianRoles = ["PHYSICIAN", "ANEST", "GO", "PEDIA", "DIR"];
        const isPhysician = (auth.roleCodes ?? []).some((r) => physicianRoles.includes(r));
        if (!isPhysician) {
          return {
            error:
              "Esta tool solo aplica a médicos (roles PHYSICIAN/ANEST/GO/PEDIA/DIR). " +
              "El usuario actual no tiene esos roles.",
          };
        }

        // Llama a la misma query agregada del router personal-salud.
        // Reusamos la lógica UNION 4 fuentes vía RPC fn directa si existiera;
        // por ahora hacemos una consulta simplificada: pacientes con
        // encounter cuyo InpatientAdmission/SurgeryCase/Outpatient/Emergency
        // los relaciona con este userId.
        try {
          // Inpatient admissions del médico (top N por fecha desc).
          const url = `InpatientAdmission?select=id,patientId,admittedAt,Patient(id,mrn,firstName,lastName)&attendingId=eq.${auth.userId}&organizationId=eq.${auth.organizationId}&order=admittedAt.desc&limit=${limit}`;
          const rows = await rpcQuery<{
            id: string;
            patientId: string;
            admittedAt: string;
            Patient: { id: string; mrn: string; firstName: string; lastName: string };
          }>(url);
          return {
            count: rows.length,
            patients: rows
              .filter((r) => r.Patient)
              .map((r) => ({
                id: r.Patient.id,
                mrn: r.Patient.mrn,
                name: `${r.Patient.firstName} ${r.Patient.lastName}`,
                lastAdmission: r.admittedAt,
                detailUrl: `/patients/${r.Patient.id}`,
              })),
            hint: "Para ver TODOS los tipos de encuentro (cirugía, ambulat., emerg.), navega a /medicos/[id] tab 'Pacientes referidos'.",
          };
        } catch (err) {
          return {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    }),

    suggestNavigation: tool({
      description:
        "Propone al usuario navegar a una URL específica del HIS. El cliente " +
        "renderizará un botón 'Ir ahí' — NO navega automáticamente; necesita " +
        "confirmación humana. Úsala cuando recomiendes una pantalla concreta y " +
        "quieras facilitar al usuario llegar con un click.",
      inputSchema: z.object({
        url: z
          .string()
          .startsWith("/")
          .max(200)
          .describe(
            "Ruta interna del HIS (ej. /admision, /triage, /medicos/[id]). Debe empezar con '/'.",
          ),
        label: z
          .string()
          .min(2)
          .max(60)
          .describe(
            "Texto del botón que verá el usuario (ej. 'Abrir Admisión', 'Ver Triage').",
          ),
        reason: z
          .string()
          .max(200)
          .describe(
            "Por qué sugieres esta navegación — 1 frase corta para mostrar como tooltip.",
          ),
      }),
      execute: async ({ url, label, reason }) => {
        // No ejecuta navegación — solo devuelve la sugerencia al cliente para
        // que renderice el botón. La acción real la hace el usuario al
        // clickearlo.
        return {
          type: "navigation_suggestion" as const,
          url,
          label,
          reason,
        };
      },
    }),
  };
}
