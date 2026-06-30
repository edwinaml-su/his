"use client";

/**
 * Encabezado del paciente (CC-0006 §5) — sticky, solo lectura salvo el contacto
 * de emergencia.
 *
 *   - Nombre 34px MAYÚSCULA, badges Expediente / Cuenta Hosp., línea demográfica
 *     (Edad · DUI · Sexo con ícono ♀/♂ · F. Nac.), domicilio y contacto de
 *     emergencia con botón Editar (§5.3, modal).
 *   - Banner de alergias (§5.1): verde "NINGUNA ALERGIA CONOCIDA" o rojo con ícono
 *     de maní y la lista. Fuente: alergias del expediente HIS (PatientAllergy).
 *   - Nota de nombre de pila (§5.2): barra lila si el paciente tiene nombre de pila
 *     o pertenece a la comunidad LGBTIQ+.
 *   - Valores en MAYÚSCULA (solo presentación); etiquetas en caso normal.
 *
 * El "Tipo de cuenta" (CONVENIO/PRIVADO) del mockup no tiene columna en el modelo
 * de datos (PatientAccount no clasifica convenio/privado), por eso se omite — no se
 * fabrica el dato. El editar emergencia actualiza la vista localmente (igual que el
 * mockup); persistir a la ficha es dominio del registro de pacientes.
 *
 * Degrada en silencio (no renderiza) mientras no haya contexto de paciente.
 */

import * as React from "react";
import { useEvolucionDraft, type ContactoEmergencia } from "../_hooks/useEvolucionDraft";
import { SEX_ICON_COLOR, PILA_LILA, ALERGIA_DANGER, CLINICO } from "../_lib/avante-palette";
import { EmergenciaModal } from "./modals/EmergenciaModal";

const NOTA_LGBTIQ =
  "Persona de la comunidad LGBTIQ+ — diríjase al paciente por su nombre de pila.";

/** Etiqueta legible del sexo biológico (en MAYÚSCULA para el encabezado). */
function sexoLabel(sexo: string | null): string {
  switch ((sexo ?? "").trim().toUpperCase()) {
    case "M":
      return "MASCULINO";
    case "F":
      return "FEMENINO";
    case "I":
      return "INTERSEXUAL";
    default:
      return "NO ESPECIFICADO";
  }
}

/** ISO (YYYY-MM-DD…) → DD/MM/YYYY sin desfase de zona horaria. */
function formatFechaNac(iso: string | null): string {
  if (!iso) return "—";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "—";
}

/** Texto del contacto: NOMBRE (PARENTESCO) — TELÉFONO. */
function buildEmerg(e: ContactoEmergencia | null): string {
  if (!e) return "—";
  const par = e.parentesco ? ` (${e.parentesco})` : "";
  const tel = e.telefono ? ` — ${e.telefono}` : "";
  return `${e.nombre}${par}${tel}`;
}

/** Badge etiqueta-atenuada + valor en negrita (Expediente / Cuenta Hosp.). */
function Tag({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs">
      <span className="text-muted-foreground">{etiqueta}</span>
      <b className="font-mono font-bold uppercase tracking-tight text-foreground">{valor}</b>
    </span>
  );
}

/** Dato de la línea demográfica: etiqueta en negrita + valor en MAYÚSCULA. */
function Demo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <b className="font-semibold text-foreground">{etiqueta}</b>
      <span className="uppercase">{children}</span>
    </span>
  );
}

const Sep = () => <span aria-hidden className="text-border">·</span>;

export function PacienteContextoBar() {
  const { draft, paciente, pacienteSexo, pacienteEdad } = useEvolucionDraft();
  const [emergenciaOverride, setEmergenciaOverride] =
    React.useState<ContactoEmergencia | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  // Sin contexto (sin episodio o cargando): no renderiza.
  if (!paciente) return null;

  const emergencia = emergenciaOverride ?? paciente.emergencia;
  const sexCode = (pacienteSexo ?? "").trim().toUpperCase();
  const sexGlyph = sexCode === "F" ? "♀" : sexCode === "M" ? "♂" : null;
  const sexColor =
    sexCode === "F" ? SEX_ICON_COLOR.F : sexCode === "M" ? SEX_ICON_COLOR.M : undefined;

  // §5.1/§10.3 — el banner refleja en vivo las alergias confirmadas en
  // Antecedentes (snapshot del draft); si aún no hay snapshot, cae a las del
  // expediente HIS (PatientAllergy).
  const antAlergias = draft.antecedentes?.alergias;
  const alergias = antAlergias
    ? antAlergias.estado === "TIENE"
      ? (antAlergias.items ?? []).filter(Boolean)
      : []
    : paciente.alergias.map((a) => a.substancia).filter(Boolean);
  const tieneAlergias = alergias.length > 0;
  const mostrarPila = !!paciente.preferredName;

  return (
    <header className="sticky top-0 z-30 mb-4 overflow-hidden rounded-xl border bg-surface-1 shadow-sm">
      <div className="px-5 py-4 sm:px-7">
        {/* Nombre + badges */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-[18px] font-extrabold uppercase leading-tight tracking-tight text-foreground sm:text-[34px]">
            {paciente.nombre ?? "—"}
          </h2>
          <Tag etiqueta="Expediente" valor={paciente.numeroExpediente} />
          {paciente.numeroCuenta && <Tag etiqueta="Cuenta Hosp." valor={paciente.numeroCuenta} />}
        </div>

        {/* Línea demográfica */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
          <Demo etiqueta="Edad">{pacienteEdad != null ? pacienteEdad : "—"}</Demo>
          <Sep />
          <Demo etiqueta="DUI">{paciente.dui ?? "—"}</Demo>
          <Sep />
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <b className="font-semibold text-foreground">Sexo</b>
            <span className="inline-flex items-center gap-0.5 uppercase">
              {sexGlyph && (
                <span aria-hidden style={{ color: sexColor }} className="text-[15px] leading-none">
                  {sexGlyph}
                </span>
              )}
              {sexoLabel(pacienteSexo)}
            </span>
          </span>
          <Sep />
          <Demo etiqueta="F. Nac.">{formatFechaNac(paciente.fechaNacimiento)}</Demo>
        </div>

        {/* Domicilio */}
        <div className="mt-1.5 text-sm text-muted-foreground">
          <b className="font-semibold text-foreground">Domicilio:</b>{" "}
          <span className="uppercase">{paciente.domicilio ?? "—"}</span>
        </div>

        {/* Contacto de emergencia + editar */}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            <b className="font-semibold text-foreground">En caso de emergencia llamar a:</b>{" "}
            <span className="uppercase">{buildEmerg(emergencia)}</span>
          </span>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Editar
          </button>
        </div>
      </div>

      {/* Banner de alergias (§5.1) */}
      <div
        className="flex items-center gap-2 border-t border-border px-5 py-2.5 text-[12.5px] font-bold uppercase tracking-wide sm:px-7"
        style={
          tieneAlergias
            ? { color: ALERGIA_DANGER.text, backgroundColor: ALERGIA_DANGER.bg }
            : { color: CLINICO.verde }
        }
      >
        {tieneAlergias ? (
          <>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinejoin="round"
              className="h-4 w-4 shrink-0"
            >
              <path d="M12 2.6c2.3 0 4 1.7 4 3.9 0 1.3-.6 2.1-.9 3.1-.3 1 .1 1.8.6 2.8.5 1 .9 2 .9 3.1 0 2.9-2.2 4.7-4.6 4.7S7.4 21.4 7.4 18.5c0-1.1.4-2.1.9-3.1.5-1 .9-1.8.6-2.8-.3-1-.9-1.8-.9-3.1 0-2.2 1.7-3.9 4-3.9Z" />
              <path d="M8.7 11.5c1.5 1 5.1 1 6.6 0" />
              <path d="M9.2 7.4c1.2.5 4.4.5 5.6 0M9.2 15.6c1.2-.5 4.4-.5 5.6 0" />
            </svg>
            <span>ALERGIAS: {alergias.join(", ")}</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4 shrink-0">
              <circle cx="12" cy="12" r="9" />
              <path d="M8.5 12.5 11 15l4.5-5" />
            </svg>
            <span>NINGUNA ALERGIA CONOCIDA</span>
          </>
        )}
      </div>

      {/* Nota de nombre de pila (§5.2) */}
      {mostrarPila && (
        <div
          className="flex items-center gap-2 border-t px-5 py-2 text-[12.5px] sm:px-7"
          style={{ color: PILA_LILA.focus, backgroundColor: PILA_LILA.bg, borderColor: PILA_LILA.border }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0">
            <circle cx="9" cy="8" r="3.2" />
            <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
            <path d="M16.5 4 18 5.5 21 2.5" />
          </svg>
          <span>
            <b className="font-semibold">Nombre de pila: {paciente.preferredName}</b>
            {paciente.esLgbtiq ? ` — ${NOTA_LGBTIQ}` : ""}
          </span>
        </div>
      )}

      <EmergenciaModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        value={emergencia}
        onSave={setEmergenciaOverride}
      />
    </header>
  );
}
