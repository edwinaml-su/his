"use client";

/**
 * WHO Surgical Safety Checklist — Formulario de 3 paneles secuenciales.
 *
 * URL: /ece/quirofano/who-check?actoId=<uuid>
 *
 * Panel 1: Sign-In  (pre-anestesia)  — disponible siempre
 * Panel 2: Time-Out (pre-incisión)   — disponible tras sign_in_completo
 * Panel 3: Sign-Out (post-cierre)    — disponible tras time_out_completo
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { CheckSquare } from "lucide-react";
import { trpc } from "@/lib/trpc/react";
import { FasePanel, type WhoItemDef } from "./_components/fase-panel";

// ---------------------------------------------------------------------------
// Definición canónica de ítems WHO 2009
// ---------------------------------------------------------------------------

const SIGN_IN_ITEMS: WhoItemDef[] = [
  { clave: "identidad_confirmada",      label: "Identidad del paciente confirmada",               conObservacion: false },
  { clave: "sitio_marcado",             label: "Sitio quirúrgico marcado",                         conObservacion: false },
  { clave: "consentimiento_firmado",    label: "Consentimiento informado firmado",                 conObservacion: false },
  { clave: "equipo_anestesia_completo", label: "Equipo de anestesia completo y verificado",        conObservacion: false },
  { clave: "pulsioximetro_funcional",   label: "Pulsioxímetro funcional colocado",                 conObservacion: false },
  { clave: "alergias_conocidas",        label: "Alergias conocidas evaluadas",                     conObservacion: true  },
  { clave: "via_aerea_dificil",         label: "Riesgo de vía aérea difícil evaluado",             conObservacion: false },
  { clave: "riesgo_hemorragia",         label: "Riesgo de hemorragia mayor evaluado (≥500 ml)",    conObservacion: false },
];

const TIME_OUT_ITEMS: WhoItemDef[] = [
  { clave: "equipo_presentado",          label: "Todos los miembros del equipo se han presentado",         conObservacion: false },
  { clave: "paciente_confirmado",        label: "Paciente, sitio quirúrgico y procedimiento confirmados",  conObservacion: false },
  { clave: "antibiotico_profilactico",   label: "Antibiótico profiláctico administrado en los 60 min previos", conObservacion: false },
  { clave: "imagenes_disponibles",       label: "Estudios de imagen esenciales disponibles en sala",        conObservacion: false },
  { clave: "eventos_criticos_discutidos","label": "Pasos críticos, duración estimada y pérdida de sangre discutidos", conObservacion: true },
  { clave: "duracion_estimada",          label: "Duración estimada de la cirugía discutida",                conObservacion: true  },
  { clave: "esterilizacion_instrumental","label": "Esterilización del instrumental confirmada (indicador incluido)", conObservacion: false },
];

const SIGN_OUT_ITEMS: WhoItemDef[] = [
  { clave: "procedimiento_confirmado",  label: "Nombre del procedimiento realizado confirmado",           conObservacion: false },
  { clave: "conteo_instrumental",       label: "Conteo de instrumental, gasas y agujas correcto",         conObservacion: false },
  { clave: "etiquetado_muestras",       label: "Muestras de anatomía patológica etiquetadas correctamente", conObservacion: false },
  { clave: "problemas_equipo",          label: "Problemas del equipo reportados",                         conObservacion: true  },
  { clave: "plan_postoperatorio",       label: "Plan postoperatorio comunicado a enfermería y anestesia",  conObservacion: false },
];

// ---------------------------------------------------------------------------
// Helpers de mapeo
// ---------------------------------------------------------------------------

function toItemValues(items: WhoItemDef[]) {
  return items.map((i) => ({
    clave: i.clave,
    label: i.label,
    verificado: false,
    observacion: "",
  }));
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function WhoChecklistPage() {
  const searchParams = useSearchParams();
  const actoId = searchParams.get("actoId") ?? "";

  const query = trpc.eceWhoChecklist.get.useQuery(
    { actoQuirurgicoId: actoId },
    { enabled: !!actoId, refetchOnWindowFocus: false },
  );

  const marcarSignIn = trpc.eceWhoChecklist.marcarSignIn.useMutation({
    onSuccess: () => query.refetch(),
  });
  const marcarTimeOut = trpc.eceWhoChecklist.marcarTimeOut.useMutation({
    onSuccess: () => query.refetch(),
  });
  const marcarSignOut = trpc.eceWhoChecklist.marcarSignOut.useMutation({
    onSuccess: () => query.refetch(),
  });

  const checklist = query.data;
  const estado = checklist?.estado ?? "iniciado";

  if (!actoId) {
    return (
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CheckSquare className="h-6 w-6" aria-hidden />
          WHO Surgical Safety Checklist
        </h1>
        <p role="alert" className="text-sm text-destructive">
          Falta el parámetro <code>actoId</code> en la URL. Accede desde el acto
          quirúrgico correspondiente.
        </p>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Cargando checklist…
      </p>
    );
  }

  if (query.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error.message}
      </p>
    );
  }

  const signInData = checklist?.fase_sign_in;
  const timeOutData = checklist?.fase_time_out;
  const signOutData = checklist?.fase_sign_out;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CheckSquare className="h-6 w-6" aria-hidden />
            WHO Surgical Safety Checklist
          </h1>
          <p className="text-sm text-muted-foreground">
            Acto quirúrgico:{" "}
            <span className="font-mono text-xs">{actoId}</span>
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            estado === "completo"
              ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          }`}
          aria-live="polite"
        >
          {estado === "iniciado" && "Iniciado"}
          {estado === "sign_in_completo" && "Sign-In completo"}
          {estado === "time_out_completo" && "Time-Out completo"}
          {estado === "completo" && "Checklist completo"}
        </span>
      </div>

      {/* Error global de mutaciones */}
      {(marcarSignIn.error || marcarTimeOut.error || marcarSignOut.error) && (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {(marcarSignIn.error ?? marcarTimeOut.error ?? marcarSignOut.error)?.message}
        </p>
      )}

      {/* Panel 1 — Sign-In */}
      <FasePanel
        titulo="Fase 1: Sign-In"
        subtitulo="Pre-anestesia — completar antes de inducción anestésica."
        items={SIGN_IN_ITEMS}
        completadoEn={signInData?.completado_en}
        responsableNombre={signInData?.responsableNombre}
        valoresIniciales={signInData?.items}
        disabled={estado !== "iniciado"}
        loading={marcarSignIn.isPending}
        onSubmit={({ responsableNombre, items }) => {
          marcarSignIn.mutate({
            actoQuirurgicoId: actoId,
            // HE-17: responsableId lo determina el server desde ctx.user.
            signIn: { responsableNombre, items },
          });
        }}
      />

      {/* Panel 2 — Time-Out */}
      <FasePanel
        titulo="Fase 2: Time-Out"
        subtitulo="Pre-incisión — todo el equipo presente en quirófano."
        items={TIME_OUT_ITEMS}
        completadoEn={timeOutData?.completado_en}
        responsableNombre={timeOutData?.responsableNombre}
        valoresIniciales={timeOutData?.items}
        disabled={estado !== "sign_in_completo"}
        loading={marcarTimeOut.isPending}
        onSubmit={({ responsableNombre, items }) => {
          marcarTimeOut.mutate({
            actoQuirurgicoId: actoId,
            // HE-17: responsableId lo determina el server desde ctx.user.
            timeOut: { responsableNombre, items },
          });
        }}
      />

      {/* Panel 3 — Sign-Out */}
      <FasePanel
        titulo="Fase 3: Sign-Out"
        subtitulo="Post-cierre — antes de que el paciente salga de quirófano."
        items={SIGN_OUT_ITEMS}
        completadoEn={signOutData?.completado_en}
        responsableNombre={signOutData?.responsableNombre}
        valoresIniciales={signOutData?.items}
        disabled={estado !== "time_out_completo"}
        loading={marcarSignOut.isPending}
        onSubmit={({ responsableNombre, items }) => {
          marcarSignOut.mutate({
            actoQuirurgicoId: actoId,
            // HE-17: responsableId lo determina el server desde ctx.user.
            signOut: { responsableNombre, items },
          });
        }}
      />
    </div>
  );
}
