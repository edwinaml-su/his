"use client";

/**
 * Nueva Historia Clínica — CC-0007.
 *
 * Ruta: /ece/historia-clinica/nueva?cuentaId=<uuid>
 * Fuente de verdad: docs/CC/0007/REQ-ECE-HC-001-historia-clinica.md
 *
 * 10 bloques clínicos, cabecera sticky, banners de alergias y nombre de pila,
 * campos narrativos por modal (G-04), antecedentes estructurados (G-05) con
 * confirmación + auditoría en negativos (G-09), examen físico con signos vitales
 * embebidos, diagnósticos CIE-11 con complemento por fila, procedimientos CPT,
 * misceláneos, plan en grid + destino, firma del médico.
 *
 * G-01: texto del usuario → MAYÚSCULAS al guardar.
 * G-06: sin localStorage/sessionStorage.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@his/ui/components/dialog";
import {
  DESTINO_OPTIONS,
  DESTINO_LABELS,
  tieneComplementario,
  type Cie11Diagnostico,
  type AntecedentesEstructurados,
  type PlanItem,
  type ProcedimientoCpt,
  type TerapiaRespiratoria,
  type OrdenExamen,
  type OrdenInyeccion,
} from "@his/contracts";
import { trpc } from "@/lib/trpc/react";

import { CampoModal } from "./_components/campo-modal";
import { PlantillasBar } from "./_components/plantillas-bar";
import {
  AntecedenteSubseccion,
  type SubseccionState,
} from "./_components/antecedente-subseccion";
import {
  SignosVitalesModal,
  buildVitalesChips,
  VITALES_INITIAL,
  type VitalesState,
} from "./_components/signos-vitales-modal";
import { DiagnosticosGrid } from "./_components/diagnosticos-grid";
import { ProcedimientosGrid } from "./_components/procedimientos-grid";
import { PlanGrid } from "./_components/plan-grid";
import { MiscelaneosConsulta } from "./_components/miscelaneos";
import { parseNum, calcularFppEg } from "./_components/utils";

// ── Constantes ─────────────────────────────────────────────────────────────────

const TIPO_CONSULTA_OPTIONS = [
  { value: "primera_vez", label: "Primera vez" },
  { value: "subsecuente", label: "Subsecuente" },
] as const;

const DESTINO_UI = DESTINO_OPTIONS.filter(
  (d) => d !== "PROCEDIMIENTO_AMBULATORIO" && d !== "REFERENCIA",
);

const STEP_LABEL: Record<string, string> = {
  ALTA_MEDICA: "Alta médica",
  ALTA_VOLUNTARIA: "Alta voluntaria",
  INGRESO: "Ingreso hospitalario",
  OBSERVACION: "Observación",
  SEGUIMIENTO: "Seguimiento",
  REMISION: "Remisión a otro centro",
  FALLECIDO: "Fallecido",
};

// ── Estado de antecedentes estructurados (inicial) ─────────────────────────────

const initSubseccion = (): SubseccionState => ({
  estado: "TIENE",
  items: [],
  auditoria: null,
});

interface AntState {
  alergias: SubseccionState;
  personales: SubseccionState;
  familiares: SubseccionState;
  ocupacion: SubseccionState;
  habitos: SubseccionState;
}

// Default "TIENE": el médico captura o confirma explícitamente el negativo (G-09).
const INIT_ANT: AntState = {
  alergias: initSubseccion(),
  personales: initSubseccion(),
  familiares: initSubseccion(),
  ocupacion: initSubseccion(),
  habitos: initSubseccion(),
};

// ── Helpers de edad ────────────────────────────────────────────────────────────

function calcEdad(birthDate: Date | string | null): string {
  if (!birthDate) return "—";
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) age--;
  return `${age} años`;
}

function isFemeninoSexo(sexo: string | null): boolean {
  return !!sexo && sexo.trim().toLowerCase().charAt(0) === "f";
}

function fmtFecha(d: Date | string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-SV", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ── Ícono de cacahuate (alérgeno) ──────────────────────────────────────────────

function PeanutIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2C8.7 2 7 4.3 7 6.5c0 1.5.8 2.8 2 3.6C7.3 11 6 12.8 6 15c0 3.3 2.7 6 6 6s6-2.7 6-6c0-2.2-1.3-4-3-4.9 1.2-.8 2-2.1 2-3.6C17 4.3 15.3 2 12 2z" />
      <path d="M12 10v4" />
    </svg>
  );
}

// ── Ícono de sexo (Venus rosa / Marte azul) ────────────────────────────────────

function IconoSexo({ sexo }: { sexo: string | null }) {
  const esFemenino = !!sexo && sexo.trim().toLowerCase().charAt(0) === "f";
  return (
    <span
      className={[
        "inline-flex h-6 w-6 flex-none items-center justify-center rounded-full",
        esFemenino
          ? "bg-pink-100 text-pink-600 dark:bg-pink-950 dark:text-pink-400"
          : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
      ].join(" ")}
      title={esFemenino ? "Femenino" : "Masculino"}
      aria-label={esFemenino ? "Sexo femenino" : "Sexo masculino"}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        {esFemenino ? (
          <>
            <circle cx="12" cy="8" r="5" />
            <path d="M12 13v8M9 18h6" />
          </>
        ) : (
          <>
            <circle cx="10" cy="14" r="5" />
            <path d="M14 10l6-6M15 4h5v5" />
          </>
        )}
      </svg>
    </span>
  );
}

// ── Componente: Cabecera sticky del paciente ────────────────────────────────────

interface PacienteHeaderProps {
  paciente: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string | null;
    preferredName: string | null;
    esLgbtiq: boolean | null;
    birthDate: Date | string | null;
    biologicalSexId: string | null;
  } | null;
  cuenta: { id: string; numeroCuenta: string | null; encounterId: string | null } | null;
  alergias: Array<{ id: string; substanceText: string; reaction: string | null; severity: string | null }>;
  contactoEmergencia: { fullName: string; relationship: string; phone: string } | null;
  onEditContacto: () => void;
}

function PacienteHeader({
  paciente,
  cuenta,
  alergias,
  contactoEmergencia,
  onEditContacto,
}: PacienteHeaderProps) {
  const nombre = paciente
    ? `${paciente.firstName} ${paciente.lastName}`
    : "Paciente no cargado";

  const conAlergias = alergias.length > 0;
  const mostrarBannerLgbtiq =
    !!paciente?.esLgbtiq && !!paciente?.preferredName;

  return (
    <div className="sticky top-[52px] z-30">
      {/* Barra de paciente */}
      <div className="flex flex-wrap items-start gap-4 border-b border-border bg-surface-1 px-6 py-3">
        <div className="flex flex-1 flex-col gap-1.5 min-w-0">
          {/* Nombre + badges de expediente/cuenta */}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[34px] font-extrabold leading-none tracking-tight">
              {nombre}
            </h1>
            {cuenta?.numeroCuenta && (
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-3 px-2.5 py-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Cuenta hosp.
                </span>
                <code className="font-mono text-xs font-bold tracking-tight text-primary">
                  {cuenta.numeroCuenta}
                </code>
              </div>
            )}
            {paciente?.mrn && (
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-3 px-2.5 py-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Expediente
                </span>
                <code className="font-mono text-xs font-bold tracking-tight text-primary">
                  {paciente.mrn}
                </code>
              </div>
            )}
          </div>
          {/* Chips de metadata */}
          <div className="flex flex-wrap gap-1.5">
            {paciente?.birthDate && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                Edad: <strong className="text-foreground">{calcEdad(paciente.birthDate)}</strong>
              </span>
            )}
            {paciente?.mrn && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                MRN: <strong className="text-foreground">{paciente.mrn}</strong>
              </span>
            )}
            {paciente?.biologicalSexId && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                <IconoSexo sexo={paciente.biologicalSexId} />
                <strong className="text-foreground">
                  {isFemeninoSexo(paciente.biologicalSexId) ? "Femenino" : "Masculino"}
                </strong>
              </span>
            )}
            {paciente?.birthDate && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                F. Nac.: <strong className="text-foreground">{fmtFecha(paciente.birthDate)}</strong>
              </span>
            )}
          </div>
          {/* Contacto de emergencia */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">En caso de emergencia llamar a:</span>
            <button
              type="button"
              onClick={onEditContacto}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input bg-surface-2 px-2.5 py-1 text-xs font-semibold uppercase transition-colors hover:border-ring"
            >
              <span>
                {contactoEmergencia
                  ? `${contactoEmergencia.fullName} (${contactoEmergencia.relationship}) — ${contactoEmergencia.phone}`
                  : "Sin contacto registrado"}
              </span>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-accent-foreground">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
                Editar
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Banner de alergias — siempre visible */}
      <div
        role="alert"
        className={[
          "flex items-start gap-3 border-b-2 px-6 py-2.5",
          conAlergias
            ? "border-allergy bg-allergy/10 text-allergy"
            : "border-success bg-success/10 text-success",
        ].join(" ")}
      >
        {conAlergias ? (
          <PeanutIcon className="mt-0.5 h-5 w-5 flex-none" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mt-0.5 h-5 w-5 flex-none">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        <div>
          <div className="text-xs font-extrabold uppercase tracking-wider">
            {conAlergias
              ? `Alergias del paciente (${alergias.length})`
              : "Ninguna alergia conocida"}
          </div>
          {conAlergias && (
            <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {alergias.map((a) => (
                <li key={a.id}>
                  <strong>{a.substanceText}</strong>
                  {a.severity && (
                    <span className="ml-1 text-[10px] uppercase opacity-80">
                      {a.severity}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Banner nombre de pila (LGBTIQ+) — solo cuando aplica */}
      {mostrarBannerLgbtiq && (
        <div
          role="status"
          className="flex items-start gap-3 border-b-2 px-6 py-2.5"
          style={{
            borderColor: "var(--lila)",
            background: "color-mix(in oklab, var(--lila) 14%, var(--background))",
            color: "var(--lila-fg)",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mt-0.5 h-4 w-4 flex-none">
            <circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="m16 11 2 2 4-4" />
          </svg>
          <div>
            <span className="text-sm font-bold">
              Nombre de pila:{" "}
              <span>{paciente.preferredName}</span>
            </span>
            <small className="block text-[11.5px] opacity-90">
              Persona de la comunidad LGBTIQ+ — dirigirse al paciente por su nombre de pila.
            </small>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Componente: Card numerada ───────────────────────────────────────────────────

function CardNumerada({
  numero,
  titulo,
  obligatorio = true,
  children,
  id,
  invalid,
}: {
  numero: number;
  titulo: string;
  obligatorio?: boolean;
  children: React.ReactNode;
  id?: string;
  invalid?: boolean;
}) {
  return (
    <div
      id={id}
      className={[
        "mb-4 overflow-hidden rounded-lg border bg-surface-1",
        invalid ? "border-destructive ring-2 ring-destructive/15" : "border-border",
      ].join(" ")}
    >
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-tight">
          <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
            {numero}
          </span>
          {titulo}
          {obligatorio ? (
            <span className="text-destructive">*</span>
          ) : (
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Opcional
            </span>
          )}
        </div>
      </div>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </div>
  );
}

// ── Página principal ────────────────────────────────────────────────────────────

export default function NuevaHistoriaClinicaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cuentaId = searchParams.get("cuentaId") ?? "";

  // ── Estado del formulario ────────────────────────────────────────────────────

  const [tipoConsulta, setTipoConsulta] = React.useState("primera_vez");
  const [motivoConsulta, setMotivoConsulta] = React.useState("");
  const [presentaEnfermedad, setPresentaEnfermedad] = React.useState("");
  const [antecedentes, setAntecedentes] = React.useState<AntState>(INIT_ANT);
  const [vitales, setVitales] = React.useState<VitalesState>(VITALES_INITIAL);
  const [vitalesOpen, setVitalesOpen] = React.useState(false);
  const [examenFisico, setExamenFisico] = React.useState("");
  const [diagnosticos, setDiagnosticos] = React.useState<Cie11Diagnostico[]>([]);
  const [procedimientos, setProcedimientos] = React.useState<ProcedimientoCpt[]>([]);
  const [terapia, setTerapia] = React.useState<TerapiaRespiratoria | null>(null);
  const [ordenesExamenes, setOrdenesExamenes] = React.useState<OrdenExamen[]>([]);
  const [ordenesInyecciones, setOrdenesInyecciones] = React.useState<OrdenInyeccion[]>([]);
  const [analisisClinico, setAnalisisClinico] = React.useState("");
  const [planItems, setPlanItems] = React.useState<PlanItem[]>([]);
  const [destino, setDestino] = React.useState<string>("");
  const [nombrePila, setNombrePila] = React.useState("");
  const [esLgbtiq, setEsLgbtiq] = React.useState(false);
  const [verMas, setVerMas] = React.useState(false);

  // Contacto de emergencia editable
  const [contacto, setContacto] = React.useState<{
    fullName: string;
    relationship: string;
    phone: string;
  } | null>(null);
  const [contactoModalOpen, setContactoModalOpen] = React.useState(false);
  const [contactoDraft, setContactoDraft] = React.useState({ fullName: "", relationship: "", phone: "" });

  // PIN firma
  const [pinOpen, setPinOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState<string | null>(null);
  const [pendingMode, setPendingMode] = React.useState<"borrador" | "firmar" | null>(null);

  // Errores de validación
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);
  const [invalidFields, setInvalidFields] = React.useState<Set<string>>(new Set());

  // ── Datos del paciente ────────────────────────────────────────────────────────

  const contextoCuentaQ = trpc.patient.contextoCuenta.useQuery(
    { cuentaId },
    { enabled: !!cuentaId && /^[0-9a-f-]{36}$/i.test(cuentaId) },
  );
  const ctx = contextoCuentaQ.data;
  const paciente = ctx?.paciente ?? null;
  const episodioId = ctx?.episodioId ?? null;
  // G-09: nombre del usuario autenticado para el sello de auditoría de antecedentes.
  const usuarioActual = ctx?.usuarioActual?.nombre ?? "USUARIO ACTUAL";

  // Inicializar contacto de emergencia desde el contexto
  React.useEffect(() => {
    if (ctx?.contactosEmergencia?.[0]) {
      const c = ctx.contactosEmergencia[0];
      setContacto({ fullName: c.fullName, relationship: c.relationship ?? "", phone: c.phone ?? "" });
    }
  }, [ctx]);

  // Alergias activas (unión: las cargadas del contexto + las que el médico agrega en el form)
  const alergiasContexto = ctx?.alergias ?? [];
  // Las alergias añadidas en el form se sincronizan con el banner en tiempo real
  const alergiasFormItems = antecedentes.alergias.estado === "TIENE" ? antecedentes.alergias.items : [];
  const alergiasDisplay = [
    ...alergiasContexto.map((a) => ({ id: a.id, substanceText: a.substanceText, reaction: a.reaction, severity: a.severity })),
    ...alergiasFormItems.map((s, i) => ({ id: `form-${i}`, substanceText: s, reaction: null, severity: null })),
  ];

  const isFemenina = !!(paciente?.biologicalSexId === "F" || paciente?.biologicalSexId?.toLowerCase().startsWith("f"));

  // ── Mutaciones tRPC ────────────────────────────────────────────────────────────

  const createM = trpc.eceHistoriaClinica.create.useMutation({
    onSuccess: (data) => {
      if (pendingMode === "firmar") {
        setPinOpen(true);
        setPendingHcId(data.id);
      } else {
        router.push("/ece/historia-clinica");
      }
      setPendingMode(null);
    },
    onError: (err) => {
      setValidationErrors([err.message]);
      setPendingMode(null);
    },
  });

  const [pendingHcId, setPendingHcId] = React.useState<string>("");

  const firmarM = trpc.eceHistoriaClinica.firmar.useMutation({
    onSuccess: () => {
      setPinOpen(false);
      setPin("");
      setPinError(null);
      router.push("/ece/historia-clinica");
    },
    onError: (err) => {
      setPinError(err.message);
    },
  });

  const signosM = trpc.eceSignosVitales.create.useMutation();

  // ── Helpers de validación ──────────────────────────────────────────────────────

  function buildAntecedentesEstructurados(): AntecedentesEstructurados {
    const sub = (s: SubseccionState) => ({
      estado: s.estado,
      items: s.items,
      ...(s.auditoria ? { auditoria: s.auditoria } : {}),
    });
    return {
      alergias: sub(antecedentes.alergias),
      personales: sub(antecedentes.personales),
      familiares: sub(antecedentes.familiares),
      ocupacion: sub(antecedentes.ocupacion),
      habitos: sub(antecedentes.habitos),
    };
  }

  function antecedentesValid(): boolean {
    return (["alergias", "personales", "familiares", "ocupacion", "habitos"] as const).every(
      (k) =>
        antecedentes[k].estado !== "TIENE" || antecedentes[k].items.length > 0,
    );
  }

  function validateForFirmar(): { valid: boolean; errors: string[]; fields: Set<string> } {
    const errs: string[] = [];
    const fields = new Set<string>();

    if (!motivoConsulta.trim()) { errs.push("Motivo de consulta es obligatorio."); fields.add("motivo"); }
    if (!presentaEnfermedad.trim()) { errs.push("Presente Enfermedad es obligatorio."); fields.add("enfermedad"); }
    if (!antecedentesValid()) { errs.push("Antecedentes: complete todas las subsecciones."); fields.add("antecedentes"); }
    if (!examenFisico.trim()) { errs.push("Examen físico es obligatorio."); fields.add("examen"); }
    if (diagnosticos.length === 0) { errs.push("Diagnósticos (CIE-11): agregue al menos uno."); fields.add("diagnosticos"); }
    if (!tieneComplementario(diagnosticos)) { errs.push("RN-03: se requiere ≥1 diagnóstico de tipo Complementario."); fields.add("diagnosticos"); }
    if (!analisisClinico.trim()) { errs.push("Análisis clínico es obligatorio."); fields.add("analisis"); }
    if (planItems.length === 0) { errs.push("Plan de manejo: agregue al menos una indicación."); fields.add("plan"); }
    if (!destino) { errs.push("Destino es obligatorio."); fields.add("destino"); }

    return { valid: errs.length === 0, errors: errs, fields };
  }

  // ── Construcción del payload ───────────────────────────────────────────────────

  // Signos vitales: toma separada en ece.signos_vitales (eceSignosVitales.create),
  // keyed por episodioId. NO se embeben en el documento HC. glasgowTotal e ICT los
  // deriva el router desde los componentes; aquí solo enviamos los componentes.
  function buildSignos() {
    const haySignos =
      Object.entries(vitales).some(([k, v]) => k !== "dolor" && v !== "") ||
      parseInt(vitales.dolor, 10) > 0;
    if (!haySignos) return undefined;
    const tallaM = parseNum(vitales.tallaM);
    return {
      presionSistolica: parseNum(vitales.sis),
      presionDiastolica: parseNum(vitales.dia),
      frecuenciaCardiaca: parseNum(vitales.fc),
      frecuenciaRespiratoria: parseNum(vitales.fr),
      temperatura: parseNum(vitales.temp),
      saturacionO2: parseNum(vitales.spo2),
      fio2: parseNum(vitales.fio2),
      glasgowOcular: parseNum(vitales.gcsO),
      glasgowVerbal: parseNum(vitales.gcsV),
      glasgowMotor: parseNum(vitales.gcsM),
      glucometriaMgdl: parseNum(vitales.gluco),
      pesoKg: parseNum(vitales.pesoKg),
      tallaCm: tallaM != null ? tallaM * 100 : undefined,
      perimetroCintura: parseNum(vitales.cintura),
      balanceHidrico: parseNum(vitales.balance),
      diuresis: parseNum(vitales.diuresis),
      fur: vitales.fur || undefined,
      fpp: vitales.fur ? calcularFppEg(vitales.fur)?.fpp : undefined,
      escalaDolor: parseNum(vitales.dolor),
    };
  }

  function buildPayload() {
    const examenFisicoPayload = examenFisico.trim()
      ? { sistemas: [{ sistema: "General", hallazgo: examenFisico.trim() }] }
      : undefined;

    return {
      episodioId: episodioId!,
      tipoConsulta: tipoConsulta as "primera_vez" | "subsecuente",
      motivoConsulta: motivoConsulta.trim() || undefined,
      enfermedadActual: presentaEnfermedad.trim() || undefined,
      destino: destino as (typeof DESTINO_OPTIONS)[number] | undefined || undefined,
      analisisClinico: analisisClinico.trim() || undefined,
      planManejo: planItems.map((p) => p.texto).join("\n") || undefined,
      antecedentesEstructurados: buildAntecedentesEstructurados(),
      planItems: planItems.length > 0 ? planItems : undefined,
      procedimientosCpt: procedimientos.length > 0 ? procedimientos : undefined,
      terapiaRespiratoria: terapia ?? undefined,
      ordenesExamenes: ordenesExamenes.length > 0 ? ordenesExamenes : undefined,
      ordenesInyecciones: ordenesInyecciones.length > 0 ? ordenesInyecciones : undefined,
      examenFisico: examenFisicoPayload,
      diagnosticos: diagnosticos.length > 0 ? diagnosticos : undefined,
    };
  }

  // Persiste la toma de signos vitales (si hay datos). Devuelve false si falla,
  // para abortar el guardado del documento HC y conservar lo capturado.
  async function persistSignos(): Promise<boolean> {
    const signos = buildSignos();
    if (!signos) return true;
    try {
      await signosM.mutateAsync({ episodioId: episodioId!, ...signos });
      return true;
    } catch (e) {
      setValidationErrors([`Error al guardar signos vitales: ${(e as Error).message}`]);
      setPendingMode(null);
      return false;
    }
  }

  // ── Guardar borrador ─────────────────────────────────────────────────────────

  async function handleGuardarBorrador() {
    if (!episodioId) return;
    setValidationErrors([]);
    setInvalidFields(new Set());
    setPendingMode("borrador");
    if (!(await persistSignos())) return;
    createM.mutate(buildPayload());
  }

  // ── Guardar y firmar ─────────────────────────────────────────────────────────

  async function handleGuardarYFirmar() {
    if (!episodioId) return;
    const { valid, errors, fields } = validateForFirmar();
    if (!valid) {
      setValidationErrors(errors);
      setInvalidFields(fields);
      // Scroll al primer error
      const firstFieldId = fields.values().next().value as string | undefined;
      if (firstFieldId) {
        document.getElementById(`card-${firstFieldId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    setValidationErrors([]);
    setInvalidFields(new Set());
    setPendingMode("firmar");
    if (!(await persistSignos())) return;
    createM.mutate(buildPayload());
  }

  function handleFirmarPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) { setPinError("Ingrese su PIN de firma electrónica."); return; }
    setPinError(null);
    firmarM.mutate({ id: pendingHcId, observacion: `pin:${pin.trim()}` });
  }

  const isSubmitting = createM.isPending || firmarM.isPending || signosM.isPending;

  const vitalesChips = buildVitalesChips(vitales);
  const hayVitales = vitalesChips.length > 0;

  // ── Estado de carga ──────────────────────────────────────────────────────────

  if (!cuentaId) {
    return (
      <div className="px-6 py-10 text-sm text-muted-foreground">
        No se especificó <code>cuentaId</code> en la URL. Use{" "}
        <code>/ece/historia-clinica/nueva?cuentaId=&lt;uuid&gt;</code>.
      </div>
    );
  }

  if (contextoCuentaQ.isLoading) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">Cargando datos del paciente…</div>;
  }

  if (contextoCuentaQ.error) {
    return (
      <div className="px-6 py-10 text-sm text-destructive" role="alert">
        {contextoCuentaQ.error.message}
      </div>
    );
  }

  if (!episodioId) {
    return (
      <div className="px-6 py-10">
        <div className="rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm text-warning">
          No hay episodio de atención abierto para esta cuenta. Abra un episodio
          antes de crear la Historia Clínica.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Cabecera sticky del paciente */}
      <PacienteHeader
        paciente={paciente}
        cuenta={ctx?.cuenta ?? null}
        alergias={alergiasDisplay}
        contactoEmergencia={contacto}
        onEditContacto={() => {
          setContactoDraft(contacto ?? { fullName: "", relationship: "", phone: "" });
          setContactoModalOpen(true);
        }}
      />

      {/* Contenido del formulario */}
      <div className="mx-auto max-w-[1180px] px-6 pb-20 pt-5">
        {/* Migas de pan */}
        <nav className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
            <path d="M3 11 12 3l9 8" /><path d="M5 10v10h14V10" />
          </svg>
          <span className="opacity-60">›</span> ECE
          <span className="opacity-60">›</span> Historia Clínica
          <span className="opacity-60">›</span> <strong className="text-foreground">Nueva</strong>
        </nav>
        <h2 className="mb-1 text-2xl font-extrabold tracking-tight">Historia Clínica</h2>

        {/* Tipo de consulta — antes de los bloques */}
        <div className="mb-4 flex items-center gap-3">
          <Label htmlFor="tipoConsulta" className="whitespace-nowrap text-sm font-semibold">
            Tipo de consulta
          </Label>
          <Select value={tipoConsulta} onValueChange={setTipoConsulta} disabled={isSubmitting}>
            <SelectTrigger id="tipoConsulta" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPO_CONSULTA_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Errores de validación */}
        {validationErrors.length > 0 && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-4 rounded-lg border border-destructive bg-destructive/8 p-4"
          >
            <p className="mb-2 text-sm font-bold text-destructive">
              Complete los campos obligatorios antes de firmar:
            </p>
            <ul className="list-disc pl-4 text-sm text-destructive">
              {validationErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── 1. Motivo de consulta ── */}
        <CardNumerada
          numero={1}
          titulo="Motivo de consulta"
          id="card-motivo"
          invalid={invalidFields.has("motivo")}
        >
          <CampoModal
            titulo="Motivo de consulta"
            placeholder="Motivo principal de la consulta"
            value={motivoConsulta}
            onChange={setMotivoConsulta}
            disabled={isSubmitting}
            invalid={invalidFields.has("motivo")}
            wrapQuotes
          />
        </CardNumerada>

        {/* ── 2. Presente Enfermedad ── */}
        <CardNumerada
          numero={2}
          titulo="Presente Enfermedad"
          id="card-enfermedad"
          invalid={invalidFields.has("enfermedad")}
        >
          <p className="mb-2 text-xs text-muted-foreground">
            Puede guardar y aplicar plantillas para agilizar este apartado.
          </p>
          <CampoModal
            titulo="Presente Enfermedad"
            placeholder="Descripción cronológica de la enfermedad…"
            value={presentaEnfermedad}
            onChange={setPresentaEnfermedad}
            disabled={isSubmitting}
            invalid={invalidFields.has("enfermedad")}
            modalHeader={
              <PlantillasBar
                campo="ENFERMEDAD_ACTUAL"
                onApply={setPresentaEnfermedad}
                currentText={presentaEnfermedad}
              />
            }
          />
        </CardNumerada>

        {/* ── 3. Antecedentes ── */}
        <CardNumerada
          numero={3}
          titulo="Antecedentes"
          id="card-antecedentes"
          invalid={invalidFields.has("antecedentes")}
        >
          <fieldset className="mb-5">
            <legend className="mb-3 border-b border-border pb-1 text-sm font-bold">
              Patológicos
            </legend>
            <AntecedenteSubseccion
              titulo="Alergias"
              estadoNegativo="NINGUNO"
              labelNegativo="Ninguna"
              value={antecedentes.alergias}
              onChange={(v) => setAntecedentes((a) => ({ ...a, alergias: v }))}
              usuarioActual={usuarioActual}
              disabled={isSubmitting}
            />
            <AntecedenteSubseccion
              titulo="Personales"
              estadoNegativo="NINGUNO"
              labelNegativo="Ninguno"
              value={antecedentes.personales}
              onChange={(v) => setAntecedentes((a) => ({ ...a, personales: v }))}
              usuarioActual={usuarioActual}
              disabled={isSubmitting}
            />
            <AntecedenteSubseccion
              titulo="Familiares"
              estadoNegativo="NINGUNO"
              labelNegativo="Ninguno"
              value={antecedentes.familiares}
              onChange={(v) => setAntecedentes((a) => ({ ...a, familiares: v }))}
              usuarioActual={usuarioActual}
              disabled={isSubmitting}
            />
          </fieldset>
          <fieldset>
            <legend className="mb-3 border-b border-border pb-1 text-sm font-bold">
              No Patológicos
            </legend>
            <AntecedenteSubseccion
              titulo="Ocupación"
              estadoNegativo="NO_APLICA"
              labelNegativo="No aplica"
              value={antecedentes.ocupacion}
              onChange={(v) => setAntecedentes((a) => ({ ...a, ocupacion: v }))}
              usuarioActual={usuarioActual}
              disabled={isSubmitting}
            />
            <AntecedenteSubseccion
              titulo="Hábitos"
              estadoNegativo="NO_APLICA"
              labelNegativo="No aplica"
              value={antecedentes.habitos}
              onChange={(v) => setAntecedentes((a) => ({ ...a, habitos: v }))}
              usuarioActual={usuarioActual}
              disabled={isSubmitting}
            />

            {/* "Ver más" — nombre de pila + LGBTIQ+ */}
            <button
              type="button"
              onClick={() => setVerMas((v) => !v)}
              aria-expanded={verMas}
              className="mt-3 flex items-center gap-1.5 rounded-md border border-dashed border-input bg-surface-1 px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={["h-4 w-4 transition-transform", verMas ? "rotate-180" : ""].join(" ")}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              {verMas ? "Ver menos" : "Ver más"}
            </button>

            {verMas && (
              <div className="mt-3 space-y-3 border-t border-dashed border-border pt-3">
                <div>
                  <Label htmlFor="nombrePila" className="text-sm font-semibold">
                    Nombre de pila{esLgbtiq && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  <Input
                    id="nombrePila"
                    placeholder="Nombre con el que prefiere ser llamado/a"
                    value={nombrePila}
                    onChange={(e) => setNombrePila(e.target.value.toUpperCase())}
                    disabled={isSubmitting}
                    className="mt-1 uppercase placeholder:normal-case"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Si el paciente pertenece a la comunidad LGBTIQ+, este nombre es obligatorio.
                  </p>
                </div>
                <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={esLgbtiq}
                    aria-labelledby="lgbtiq-switch-label"
                    onClick={() => setEsLgbtiq((v) => !v)}
                    className={[
                      "relative inline-flex h-6 w-10 flex-none cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
                      esLgbtiq ? "bg-primary" : "bg-input",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                        esLgbtiq ? "translate-x-4" : "translate-x-0.5",
                      ].join(" ")}
                    />
                  </button>
                  <div>
                    <span id="lgbtiq-switch-label" className="text-sm font-semibold">
                      Paciente de comunidad LGBTIQ+
                    </span>
                    <small className="block text-xs text-muted-foreground">
                      Activa el banner inamovible de nombre de pila.
                    </small>
                  </div>
                </div>
              </div>
            )}
          </fieldset>
        </CardNumerada>

        {/* ── 4. Examen físico (signos vitales + narrativa) ── */}
        <CardNumerada
          numero={4}
          titulo="Examen físico"
          id="card-examen"
          invalid={invalidFields.has("examen")}
        >
          {/* Subsección A — Signos vitales (toma separada en ece.signos_vitales) */}
          <fieldset className="mb-5">
            <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
              Signos vitales
            </legend>
            <p className="mb-3 text-xs text-muted-foreground">
              La presión arterial y los signos cardiorrespiratorios son obligatorios; el resto es opcional.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {hayVitales ? (
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {vitalesChips.map((chip, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="flex-1 text-sm text-muted-foreground">
                  Signos vitales sin registrar.
                </span>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => setVitalesOpen(true)}
                disabled={isSubmitting}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mr-1.5 h-4 w-4">
                  <path d="M3 12h4l2 5 4-12 2 7h6" />
                </svg>
                {hayVitales ? "Modificar signos vitales" : "Registrar signos vitales"}
              </Button>
            </div>
          </fieldset>

          {/* Subsección B — Hallazgos del examen físico */}
          <fieldset>
            <legend className="mb-2 border-b border-border pb-1 text-sm font-bold">
              Hallazgos
            </legend>
            <p className="mb-2 text-xs text-muted-foreground">
              Puede guardar y aplicar plantillas para agilizar este apartado.
            </p>
            <CampoModal
              titulo="Examen físico"
              placeholder="Descripción del examen físico…"
              value={examenFisico}
              onChange={setExamenFisico}
              disabled={isSubmitting}
              invalid={invalidFields.has("examen")}
              modalHeader={
                <PlantillasBar
                  campo="EXAMEN_FISICO"
                  onApply={setExamenFisico}
                  currentText={examenFisico}
                />
              }
            />
          </fieldset>
        </CardNumerada>

        {/* ── 5. Diagnósticos CIE-11 ── */}
        <CardNumerada
          numero={5}
          titulo="Diagnósticos (CIE-11)"
          id="card-diagnosticos"
          invalid={invalidFields.has("diagnosticos")}
        >
          <DiagnosticosGrid
            value={diagnosticos}
            onChange={setDiagnosticos}
            disabled={isSubmitting}
            invalid={invalidFields.has("diagnosticos")}
          />
        </CardNumerada>

        {/* ── 6. Procedimientos CPT ── */}
        <CardNumerada
          numero={6}
          titulo="Procedimientos (CPT)"
          obligatorio={false}
          id="card-procedimientos"
        >
          <p className="mb-2 text-xs text-muted-foreground">
            Terminología de Procedimientos Actuales (CPT) con búsqueda autocompletada.
          </p>
          <ProcedimientosGrid
            value={procedimientos}
            onChange={setProcedimientos}
            disabled={isSubmitting}
          />
        </CardNumerada>

        {/* ── 7. Misceláneos ── */}
        <CardNumerada
          numero={7}
          titulo="Misceláneos de consulta"
          obligatorio={false}
          id="card-miscelaneos"
        >
          <MiscelaneosConsulta
            terapiaRespiratoria={terapia}
            onTerapia={setTerapia}
            ordenesExamenes={ordenesExamenes}
            onOrdenesExamenes={setOrdenesExamenes}
            ordenesInyecciones={ordenesInyecciones}
            onOrdenesInyecciones={setOrdenesInyecciones}
            disabled={isSubmitting}
          />
        </CardNumerada>

        {/* ── 8. Análisis clínico ── */}
        <CardNumerada
          numero={8}
          titulo="Análisis clínico"
          id="card-analisis"
          invalid={invalidFields.has("analisis")}
        >
          <Label className="mb-1 block text-xs text-muted-foreground">
            Razonamiento / correlación clínica
          </Label>
          <CampoModal
            titulo="Análisis clínico"
            placeholder="Análisis y correlación clínica del caso…"
            value={analisisClinico}
            onChange={setAnalisisClinico}
            disabled={isSubmitting}
            invalid={invalidFields.has("analisis")}
          />
        </CardNumerada>

        {/* ── 9. Plan + Destino ── */}
        <CardNumerada
          numero={9}
          titulo="Plan"
          id="card-plan"
          invalid={invalidFields.has("plan") || invalidFields.has("destino")}
        >
          <div className="mb-4">
            <Label className="mb-2 block text-sm font-semibold">Plan de manejo</Label>
            <PlanGrid
              value={planItems}
              onChange={setPlanItems}
              disabled={isSubmitting}
              invalid={invalidFields.has("plan")}
            />
          </div>
          <div>
            <Label htmlFor="destino" className="mb-1.5 block text-sm font-semibold">
              Destino <span className="text-destructive">*</span>
            </Label>
            <Select value={destino} onValueChange={setDestino} disabled={isSubmitting}>
              <SelectTrigger
                id="destino"
                className={invalidFields.has("destino") ? "border-destructive ring-2 ring-destructive/20" : ""}
              >
                <SelectValue placeholder="Seleccione destino" />
              </SelectTrigger>
              <SelectContent>
                {DESTINO_UI.map((v) => (
                  <SelectItem key={v} value={v}>
                    {STEP_LABEL[v] ?? DESTINO_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardNumerada>

        {/* ── 10. Firma del médico ── */}
        <CardNumerada
          numero={10}
          titulo="Firma del médico"
          id="card-firma"
        >
          <p className="mb-3 text-xs text-muted-foreground">
            El grafo y el sello se traen de la ficha médica del médico registrado.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Grafo */}
            <div className="flex flex-col rounded-md border border-border bg-surface-2 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                  <path d="M3 17c3-1 4-4 6-4s2 3 4 3 3-6 5-6" /><path d="M3 21h18" />
                </svg>
                Grafo (firma registrada)
              </div>
              <div className="flex flex-1 items-center justify-center py-4">
                <svg viewBox="0 0 260 90" width={240} height={84} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 64c14-2 20-40 30-40s8 46 18 46 14-44 24-44 6 38 16 38 12-22 22-22" />
                  <path d="M150 60c10 4 26 2 40-2s24-10 30-6" />
                  <path d="M196 30c8 6 12 18 6 26" />
                </svg>
              </div>
              <div className="mt-2 border-t border-foreground pt-2 text-center">
                <div className="text-xs font-bold uppercase">Médico tratante</div>
                <div className="text-xs text-muted-foreground">
                  Grafo traído de ficha médica
                </div>
              </div>
            </div>
            {/* Sello */}
            <div className="flex flex-col items-center rounded-md border border-border bg-surface-2 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v10M7 12h10" />
                </svg>
                Sello registrado
              </div>
              <svg viewBox="0 0 130 130" width={110} height={110} fill="none">
                <circle cx="65" cy="65" r="58" stroke="var(--primary)" strokeWidth={3} />
                <circle cx="65" cy="65" r="48" stroke="var(--primary)" strokeWidth={1.5} />
                <text x="65" y="56" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--primary)">
                  MÉDICO TRATANTE
                </text>
                <text x="65" y="72" textAnchor="middle" fontSize="9" fill="var(--primary)">
                  FIRMA ELECTRÓNICA
                </text>
                <text x="65" y="86" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--primary)">
                  JVPM · FICHA MÉDICA
                </text>
              </svg>
              <div className="mt-1 text-center text-xs text-muted-foreground">
                Sello oficial del profesional
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Grafo y sello traídos automáticamente de la ficha médica del médico registrado.
          </div>
        </CardNumerada>

        {/* ── Footer de acciones ── */}
        <div className="flex justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void handleGuardarBorrador()}
            disabled={isSubmitting || !episodioId}
          >
            {createM.isPending && pendingMode === "borrador" ? "Guardando…" : "Guardar borrador"}
          </Button>
          <Button
            type="button"
            onClick={() => void handleGuardarYFirmar()}
            disabled={isSubmitting || !episodioId}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mr-1.5 h-4 w-4">
              <path d="M3 17c3-1 4-4 6-4s2 3 4 3 3-6 5-6" /><path d="M3 21h18" />
            </svg>
            {createM.isPending && pendingMode === "firmar" ? "Procesando…" : "Guardar y firmar"}
          </Button>
        </div>
      </div>

      {/* Modal de signos vitales */}
      <SignosVitalesModal
        open={vitalesOpen}
        onClose={() => setVitalesOpen(false)}
        value={vitales}
        onSave={setVitales}
        isFemenina={isFemenina}
      />

      {/* Modal de PIN de firma */}
      <Dialog open={pinOpen} onOpenChange={(o) => !o && !firmarM.isPending && setPinOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Firmar historia clínica</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleFirmarPin} className="space-y-3">
            <div>
              <Label htmlFor="pin" className="text-sm">
                PIN de firma electrónica
              </Label>
              <Input
                id="pin"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoFocus
                disabled={firmarM.isPending}
                className="mt-1"
              />
            </div>
            {pinError && (
              <p role="alert" className="text-xs text-destructive">{pinError}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setPinOpen(false); setPin(""); setPinError(null); }}
                disabled={firmarM.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={firmarM.isPending || !pin.trim()}>
                {firmarM.isPending ? "Firmando…" : "Firmar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de contacto de emergencia */}
      <Dialog open={contactoModalOpen} onOpenChange={(o) => !o && setContactoModalOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>En caso de emergencia llamar a</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="emerg-nombre">Nombre del contacto</Label>
              <Input
                id="emerg-nombre"
                className="mt-1 uppercase placeholder:normal-case"
                placeholder="Nombre completo"
                value={contactoDraft.fullName}
                onChange={(e) => setContactoDraft((d) => ({ ...d, fullName: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <Label htmlFor="emerg-parentesco">Parentesco</Label>
              <Input
                id="emerg-parentesco"
                className="mt-1 uppercase placeholder:normal-case"
                placeholder="Madre, hijo, cónyuge…"
                value={contactoDraft.relationship}
                onChange={(e) => setContactoDraft((d) => ({ ...d, relationship: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <Label htmlFor="emerg-tel">Teléfono</Label>
              <Input
                id="emerg-tel"
                className="mt-1"
                inputMode="tel"
                placeholder="Número de teléfono"
                value={contactoDraft.phone}
                onChange={(e) => setContactoDraft((d) => ({ ...d, phone: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setContactoModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                setContacto({ ...contactoDraft });
                setContactoModalOpen(false);
              }}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
