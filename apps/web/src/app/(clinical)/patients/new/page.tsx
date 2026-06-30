"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@his/ui/components/switch";
import { cn } from "@his/ui/lib/utils";
import { ScanLine, TriangleAlert, Check, Info } from "lucide-react";
import { trpc } from "@/lib/trpc/react";
import { parseDateOnly } from "@/lib/date-only";
import { calcularEdad } from "@/lib/edad";
import { parseDocumento, type TipoDocumento } from "@/lib/parse-documento";

// CC-0008 §5/§9 — tipos de documento del pre-registro. Se mapea al enum del
// modelo Patient existente (CARNET_RESIDENCIA), no al greenfield del spec.
type DocTipoUI = "DUI" | "PASAPORTE" | "CARNET_RESIDENCIA";

const TIPO_LABEL: Record<DocTipoUI, string> = {
  DUI: "DUI",
  PASAPORTE: "Pasaporte",
  CARNET_RESIDENCIA: "Carnet de Residente",
};

// El contrato del parser usa CARNET_RESIDENTE; el modelo/BD usa CARNET_RESIDENCIA.
const PARSER_TIPO: Record<DocTipoUI, TipoDocumento> = {
  DUI: "DUI",
  PASAPORTE: "PASAPORTE",
  CARNET_RESIDENCIA: "CARNET_RESIDENTE",
};

// Sexo del documento (enum del parser) → código del catálogo BiologicalSex.
const SEXO_CODE: Record<"MASCULINO" | "FEMENINO", "M" | "F"> = {
  MASCULINO: "M",
  FEMENINO: "F",
};

type CampoCapturable =
  | "numeroDocumento"
  | "primerNombre"
  | "segundoNombre"
  | "tercerNombre"
  | "primerApellido"
  | "segundoApellido"
  | "apellidoCasada"
  | "biologicalSexId"
  | "fechaNacimiento";

const hoyISO = () => new Date().toISOString().slice(0, 10);

// Chip de radio con indicador de punto, fiel a la paleta del mockup CC-0008.
function Chip({
  name,
  value,
  checked,
  captured,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  captured?: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer select-none items-center gap-[9px] rounded-lg border px-4 py-[11px] text-sm transition-colors",
        checked
          ? "border-[#0B3D5C] bg-[#EEF5FA] font-semibold text-[#0B3D5C]"
          : cn(
              "bg-white font-medium text-[#15212E] hover:border-[#00A8B5]",
              captured ? "border-[#00A8B5] bg-[#E6F7F8]" : "border-[#C6D0DB]",
            ),
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        className={cn(
          "grid h-4 w-4 flex-none place-items-center rounded-full border-2",
          checked ? "border-[#0B3D5C]" : "border-[#C6D0DB]",
        )}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[#0B3D5C]" />}
      </span>
      {children}
    </label>
  );
}

/**
 * Pre-registro de paciente (CC-0008 / REQ-ECE-PRE-001).
 *
 * Alta inicial asistida por escaneo de documento: tipo de documento primero,
 * switch "¿trae documento?", nombres/apellidos extendidos, sexo biológico por
 * radio y edad derivada (no persistida). El expediente {PAIS}{AA}{NNNNN} se
 * genera en servidor (CC-0002); el MRN ya no se captura (autogenerado).
 *
 * Paleta y layout fieles al mockup docs/CC/0008/preregistro.html (navy/teal).
 */
export default function PreRegistroPage() {
  const router = useRouter();

  React.useEffect(() => {
    document.title = "Pre-registro · HIS Avante";
  }, []);

  const sexes = trpc.catalog.list.useQuery({ catalog: "biologicalSex", activeOnly: true });
  // §10/AC3 — radios solo Masculino/Femenino (códigos M/F del catálogo).
  const sexOptions = React.useMemo(
    () =>
      (sexes.data ?? []).filter(
        (s: { code: string }) => s.code === "M" || s.code === "F",
      ) as Array<{ id: string; code: string; name: string }>,
    [sexes.data],
  );

  const [created, setCreated] = React.useState<{ id: string; expediente: string | null } | null>(
    null,
  );

  const create = trpc.patient.create.useMutation({
    onSuccess: (p) => setCreated({ id: p.id, expediente: p.expediente ?? null }),
  });

  const [form, setForm] = React.useState({
    traeDocumento: true,
    tipoDocumento: "DUI" as DocTipoUI,
    numeroDocumento: "",
    primerNombre: "",
    segundoNombre: "",
    tercerNombre: "",
    primerApellido: "",
    segundoApellido: "",
    apellidoCasada: "",
    biologicalSexId: "",
    fechaNacimiento: "",
  });

  // Campos poblados por escaneo (resaltado teal + aviso de verificación).
  const [captured, setCaptured] = React.useState<Set<CampoCapturable>>(new Set());

  const [validationError, setValidationError] = React.useState<{
    field: string | null;
    message: string;
  }>({ field: null, message: "" });

  // Edad derivada (§8) — recalcula en cada render según fechaNacimiento.
  const nacimiento = parseDateOnly(form.fechaNacimiento);
  const edad = nacimiento ? calcularEdad(nacimiento) : null;

  const setField = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setCaptured((c) => {
      if (!c.has(key as CampoCapturable)) return c;
      const next = new Set(c);
      next.delete(key as CampoCapturable);
      return next;
    });
    if (validationError.field === key) setValidationError({ field: null, message: "" });
  };

  // Clase de input fiel al mockup: borde fuerte sobre field-bg, foco teal,
  // captura teal y error rojo.
  const fieldCls = (key: CampoCapturable, invalid?: boolean) =>
    cn(
      "w-full rounded-lg border bg-[#F8FAFC] px-[13px] py-[11px] text-sm text-[#15212E] outline-none transition-colors placeholder:text-[#9AA8B6] focus:border-[#00A8B5] focus:bg-white focus:ring-[3px] focus:ring-[#00A8B5]/20",
      captured.has(key) ? "border-[#00A8B5] bg-[#E6F7F8]" : "border-[#C6D0DB]",
      invalid && "border-[#DC2626] focus:border-[#DC2626]",
    );

  // §7 — escaneo simulado: puebla campos y los marca como capturados.
  const onScan = () => {
    const d = parseDocumento("", PARSER_TIPO[form.tipoDocumento]);
    const sexId =
      sexOptions.find((s) => s.code === SEXO_CODE[d.sexoBiologico])?.id ?? form.biologicalSexId;

    setForm((f) => ({
      ...f,
      numeroDocumento: d.numeroDocumento,
      primerNombre: d.primerNombre,
      segundoNombre: d.segundoNombre ?? "",
      tercerNombre: d.tercerNombre ?? "",
      primerApellido: d.primerApellido,
      segundoApellido: d.segundoApellido ?? "",
      apellidoCasada: d.apellidoCasada ?? "",
      biologicalSexId: sexId,
      fechaNacimiento: d.fechaNacimiento,
    }));

    const marcados = new Set<CampoCapturable>(["numeroDocumento", "primerNombre", "primerApellido"]);
    if (d.segundoNombre) marcados.add("segundoNombre");
    if (d.tercerNombre) marcados.add("tercerNombre");
    if (d.segundoApellido) marcados.add("segundoApellido");
    if (d.apellidoCasada) marcados.add("apellidoCasada");
    if (sexId) marcados.add("biologicalSexId");
    marcados.add("fechaNacimiento");
    setCaptured(marcados);
    setValidationError({ field: null, message: "" });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.primerNombre.trim()) {
      return setValidationError({ field: "primerNombre", message: "Ingresa el primer nombre." });
    }
    if (!form.primerApellido.trim()) {
      return setValidationError({ field: "primerApellido", message: "Ingresa el primer apellido." });
    }
    if (!form.biologicalSexId) {
      return setValidationError({
        field: "sexoBiologico",
        message: "Selecciona el sexo biológico — campo obligatorio para protocolos clínicos.",
      });
    }
    if (!form.fechaNacimiento) {
      return setValidationError({
        field: "fechaNacimiento",
        message: "Ingresa la fecha de nacimiento — requerida para generar el expediente.",
      });
    }
    if (form.fechaNacimiento > hoyISO()) {
      return setValidationError({
        field: "fechaNacimiento",
        message: "La fecha de nacimiento no puede ser futura.",
      });
    }

    // §6 — documento obligatorio solo cuando el paciente lo trae.
    if (form.traeDocumento) {
      if (!form.numeroDocumento.trim()) {
        return setValidationError({
          field: "numeroDocumento",
          message: "Ingresa el número de documento.",
        });
      }
      if (form.tipoDocumento === "DUI" && !/^\d{8}-\d$/.test(form.numeroDocumento.trim())) {
        return setValidationError({
          field: "numeroDocumento",
          message: "Formato DUI inválido (########-#).",
        });
      }
    }

    setValidationError({ field: null, message: "" });

    create.mutate({
      firstName: form.primerNombre.trim(),
      middleName: form.segundoNombre.trim() || undefined,
      thirdName: form.tercerNombre.trim() || undefined,
      lastName: form.primerApellido.trim(),
      secondLastName: form.segundoApellido.trim() || undefined,
      marriedLastName: form.apellidoCasada.trim() || undefined,
      biologicalSexId: form.biologicalSexId,
      // La validación previa garantiza fechaNacimiento no vacía → Date no-null.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      birthDate: parseDateOnly(form.fechaNacimiento)!,
      birthDateEstimated: false,
      isUnknown: false,
      traeDocumento: form.traeDocumento,
      documentType: form.traeDocumento ? form.tipoDocumento : undefined,
      documentNumber: form.traeDocumento ? form.numeroDocumento.trim() : undefined,
    });
  };

  if (created) {
    return (
      <div className="mx-auto max-w-[920px] px-7 pb-14 pt-1.5">
        <h1 className="my-[18px] text-[26px] font-bold text-[#0B3D5C]">Pre-registro</h1>
        <div className="rounded-xl border border-[#DDE3EA] bg-white px-7 pb-[30px] pt-[26px] shadow-[0_1px_2px_rgba(16,40,64,.06),0_1px_3px_rgba(16,40,64,.04)]">
          <div role="status" className="space-y-4">
            <p className="text-sm text-[#5B6B7B]">
              Paciente registrado.{" "}
              {created.expediente ? (
                <span className="font-semibold text-[#15212E]">
                  Expediente: {created.expediente}
                </span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={() => router.push(`/patients/${created.id}`)}
              className="rounded-lg bg-[#0B3D5C] px-[26px] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0E4A6E]"
            >
              Ver expediente del paciente
            </button>
          </div>
        </div>
      </div>
    );
  }

  const scanned = captured.size > 0;

  return (
    <div className="mx-auto max-w-[920px] px-7 pb-14 pt-1.5">
      <h1 className="my-[18px] text-[26px] font-bold text-[#0B3D5C]">Pre-registro</h1>

      <div className="rounded-xl border border-[#DDE3EA] bg-white px-7 pb-[30px] pt-[26px] shadow-[0_1px_2px_rgba(16,40,64,.06),0_1px_3px_rgba(16,40,64,.04)]">
        <h2 className="mb-1.5 text-[17px] font-bold text-[#15212E]">Datos básicos</h2>
        <p className="mb-[22px] flex flex-wrap items-center gap-1.5 text-[12.5px] text-[#5B6B7B]">
          Todos los campos son obligatorios.
          <span className="font-bold text-[#DC2626]">*</span> obligatorio · los campos sin marca
          aplican solo cuando corresponde.
        </p>

        <form onSubmit={onSubmit}>
          {/* §6 — switch ¿trae documento? (default ON) */}
          <div className="mb-6 flex items-start gap-[14px] rounded-lg border border-[#DDE3EA] bg-[#F8FAFC] px-[18px] py-4">
            <Switch
              id="traeDocumento"
              checked={form.traeDocumento}
              onCheckedChange={(v) => setForm((f) => ({ ...f, traeDocumento: v }))}
              className="mt-0.5 data-[state=checked]:bg-[#00A8B5]"
            />
            <div>
              <label
                htmlFor="traeDocumento"
                className="block text-sm font-semibold text-[#15212E]"
              >
                El paciente trae documento de identidad
              </label>
              <span className="mt-0.5 block text-[12.5px] text-[#5B6B7B]">
                Si está activo, escanea el QR o código de barras del documento para llenar el
                preregistro automáticamente.
              </span>
            </div>
          </div>

          {/* Aviso de captura manual cuando NO trae documento */}
          {!form.traeDocumento && (
            <div
              role="note"
              className="mb-[22px] flex items-center gap-[9px] rounded-lg border border-[#F4D9A6] bg-[#FEF6E7] px-[14px] py-3 text-[13px] text-[#92520E]"
            >
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              Captura manual — el paciente no presenta documento. Ingrese los datos de
              identificación a mano.
            </div>
          )}

          {/* §4/§5 — bloque de documento (tipo primero), solo si trae documento */}
          {form.traeDocumento && (
            <div>
              <div className="mb-3.5 text-[11.5px] font-bold uppercase tracking-[1px] text-[#5B6B7B]">
                Documento
              </div>

              <div className="mb-[18px]">
                <span className="mb-2 block text-[13px] font-semibold text-[#15212E]">
                  Tipo de documento <span className="ml-0.5 text-[#DC2626]">*</span>
                </span>
                <div role="radiogroup" aria-label="Tipo de documento" className="flex flex-wrap gap-[10px]">
                  {(Object.keys(TIPO_LABEL) as DocTipoUI[]).map((t) => (
                    <Chip
                      key={t}
                      name="tipoDocumento"
                      value={t}
                      checked={form.tipoDocumento === t}
                      onChange={() => setForm((f) => ({ ...f, tipoDocumento: t }))}
                    >
                      {TIPO_LABEL[t]}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="mb-[18px]">
                <label
                  htmlFor="numeroDocumento"
                  className="mb-2 block text-[13px] font-semibold text-[#15212E]"
                >
                  Número de Documento <span className="ml-0.5 text-[#DC2626]">*</span>
                </label>
                <input
                  id="numeroDocumento"
                  value={form.numeroDocumento}
                  onChange={(e) => setField("numeroDocumento", e.target.value)}
                  placeholder="Escanee o ingrese el número del documento"
                  className={fieldCls("numeroDocumento", validationError.field === "numeroDocumento")}
                  aria-invalid={validationError.field === "numeroDocumento"}
                  aria-describedby={
                    validationError.field === "numeroDocumento" ? "numeroDocumento-error" : undefined
                  }
                />
                {validationError.field === "numeroDocumento" && (
                  <p id="numeroDocumento-error" role="alert" className="mt-1.5 text-sm text-[#DC2626]">
                    {validationError.message}
                  </p>
                )}
              </div>

              <div className="mb-[26px] mt-1 flex flex-col gap-[10px]">
                <button
                  type="button"
                  onClick={onScan}
                  className="inline-flex items-center justify-center gap-[10px] rounded-lg border-[1.5px] border-dashed border-[#00A8B5] bg-[#E6F7F8] px-[18px] py-[14px] text-sm font-semibold text-[#018592] transition-colors hover:border-solid hover:bg-[#D6F2F4]"
                >
                  <ScanLine className="h-5 w-5" aria-hidden />
                  Escanear documento (QR / código de barras)
                </button>

                {scanned && (
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-md border border-[#00A8B5] bg-[#E6F7F8] px-3 py-[9px] text-[12.5px] font-medium text-[#018592]"
                  >
                    <Check className="h-4 w-4 shrink-0" aria-hidden />
                    Datos obtenidos del documento. Verifique antes de continuar.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* §5/§9 — Identificación: nombres y apellidos (hasta 3 c/u) */}
          <div className="mb-3.5 mt-1.5 border-t border-[#DDE3EA] pt-5 text-[11.5px] font-bold uppercase tracking-[1px] text-[#5B6B7B]">
            Identificación del paciente
          </div>

          <div className="mb-[18px]">
            <span className="mb-2 block text-[13px] font-semibold text-[#15212E]">Nombres</span>
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-3">
              <div>
                <label htmlFor="primerNombre" className="mb-1.5 block text-xs font-medium text-[#5B6B7B]">
                  Primer nombre <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  id="primerNombre"
                  value={form.primerNombre}
                  onChange={(e) => setField("primerNombre", e.target.value)}
                  placeholder="Primer nombre"
                  className={fieldCls("primerNombre", validationError.field === "primerNombre")}
                  aria-invalid={validationError.field === "primerNombre"}
                  aria-describedby={
                    validationError.field === "primerNombre" ? "primerNombre-error" : undefined
                  }
                />
                {validationError.field === "primerNombre" && (
                  <p id="primerNombre-error" role="alert" className="mt-1.5 text-sm text-[#DC2626]">
                    {validationError.message}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="segundoNombre" className="mb-1.5 block text-xs font-medium text-[#5B6B7B]">
                  Segundo nombre <span className="ml-1 font-normal text-[#5B6B7B]">(opcional)</span>
                </label>
                <input
                  id="segundoNombre"
                  value={form.segundoNombre}
                  onChange={(e) => setField("segundoNombre", e.target.value)}
                  placeholder="Segundo nombre"
                  className={fieldCls("segundoNombre")}
                />
              </div>
              <div>
                <label htmlFor="tercerNombre" className="mb-1.5 block text-xs font-medium text-[#5B6B7B]">
                  Tercer nombre <span className="ml-1 font-normal text-[#5B6B7B]">(opcional)</span>
                </label>
                <input
                  id="tercerNombre"
                  value={form.tercerNombre}
                  onChange={(e) => setField("tercerNombre", e.target.value)}
                  placeholder="Tercer nombre"
                  className={fieldCls("tercerNombre")}
                />
              </div>
            </div>
          </div>

          <div className="mb-[18px]">
            <span className="mb-2 block text-[13px] font-semibold text-[#15212E]">Apellidos</span>
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-3">
              <div>
                <label htmlFor="primerApellido" className="mb-1.5 block text-xs font-medium text-[#5B6B7B]">
                  Primer apellido <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  id="primerApellido"
                  value={form.primerApellido}
                  onChange={(e) => setField("primerApellido", e.target.value)}
                  placeholder="Primer apellido"
                  className={fieldCls("primerApellido", validationError.field === "primerApellido")}
                  aria-invalid={validationError.field === "primerApellido"}
                  aria-describedby={
                    validationError.field === "primerApellido" ? "primerApellido-error" : undefined
                  }
                />
                {validationError.field === "primerApellido" && (
                  <p id="primerApellido-error" role="alert" className="mt-1.5 text-sm text-[#DC2626]">
                    {validationError.message}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="segundoApellido" className="mb-1.5 block text-xs font-medium text-[#5B6B7B]">
                  Segundo apellido <span className="ml-1 font-normal text-[#5B6B7B]">(opcional)</span>
                </label>
                <input
                  id="segundoApellido"
                  value={form.segundoApellido}
                  onChange={(e) => setField("segundoApellido", e.target.value)}
                  placeholder="Segundo apellido"
                  className={fieldCls("segundoApellido")}
                />
              </div>
              <div>
                <label htmlFor="apellidoCasada" className="mb-1.5 block text-xs font-medium text-[#5B6B7B]">
                  Apellido de casada <span className="ml-1 font-normal text-[#5B6B7B]">(si aplica)</span>
                </label>
                <input
                  id="apellidoCasada"
                  value={form.apellidoCasada}
                  onChange={(e) => setField("apellidoCasada", e.target.value)}
                  placeholder="de…"
                  className={fieldCls("apellidoCasada")}
                />
              </div>
            </div>
          </div>

          {/* §10/AC3 — sexo biológico como radio */}
          <div className="mb-[18px]">
            <span className="mb-2 block text-[13px] font-semibold text-[#15212E]">
              Sexo biológico <span className="ml-0.5 text-[#DC2626]">*</span>
            </span>
            <div role="radiogroup" aria-label="Sexo biológico" className="flex flex-wrap gap-[10px]">
              {sexOptions.map((s) => (
                <Chip
                  key={s.id}
                  name="sexoBiologico"
                  value={s.id}
                  checked={form.biologicalSexId === s.id}
                  captured={captured.has("biologicalSexId")}
                  onChange={() => setField("biologicalSexId", s.id)}
                >
                  {s.name}
                </Chip>
              ))}
            </div>
            {validationError.field === "sexoBiologico" && (
              <p role="alert" className="mt-1.5 text-sm text-[#DC2626]">
                {validationError.message}
              </p>
            )}
          </div>

          {/* §5 — fecha de nacimiento + §8 edad derivada */}
          <div className="mb-[18px]">
            <label htmlFor="fechaNacimiento" className="mb-2 block text-[13px] font-semibold text-[#15212E]">
              Fecha de nacimiento <span className="ml-0.5 text-[#DC2626]">*</span>
            </label>
            <div className="flex flex-wrap items-center gap-[14px]">
              <input
                id="fechaNacimiento"
                type="date"
                max={hoyISO()}
                value={form.fechaNacimiento}
                onChange={(e) => setField("fechaNacimiento", e.target.value)}
                className={cn(
                  fieldCls("fechaNacimiento", validationError.field === "fechaNacimiento"),
                  "max-w-[240px]",
                )}
                aria-invalid={validationError.field === "fechaNacimiento"}
                aria-describedby={
                  validationError.field === "fechaNacimiento" ? "fechaNacimiento-error" : undefined
                }
              />
              {edad && (
                <div className="flex items-center gap-[10px] rounded-lg border border-[#00A8B5] bg-[#E6F7F8] px-4 py-[9px]">
                  <span className="text-[11px] font-bold uppercase tracking-[0.6px] text-[#018592]">
                    Edad
                  </span>
                  <strong
                    data-testid="edad-derivada"
                    className="text-lg font-bold leading-none text-[#0B3D5C]"
                  >
                    {edad.label}
                  </strong>
                </div>
              )}
            </div>
            {validationError.field === "fechaNacimiento" && (
              <p id="fechaNacimiento-error" role="alert" className="mt-1.5 text-sm text-[#DC2626]">
                {validationError.message}
              </p>
            )}
            {form.traeDocumento && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#5B6B7B]">
                <Info className="h-3 w-3 shrink-0" aria-hidden />
                Se obtiene del documento al escanear; la edad se calcula automáticamente con la
                fecha actual.
              </p>
            )}
          </div>

          {create.error?.message && (
            <p role="alert" className="mt-3 text-sm text-[#DC2626]">
              {create.error.message}
            </p>
          )}

          <div className="mt-[26px] flex items-center gap-3 border-t border-[#DDE3EA] pt-[22px]">
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-lg bg-[#0B3D5C] px-[26px] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0E4A6E] disabled:opacity-60"
            >
              {create.isPending ? "Guardando…" : "Crear preregistro"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/patients")}
              className="rounded-lg border border-[#C6D0DB] px-5 py-3 text-sm font-medium text-[#15212E] transition-colors hover:bg-[#F8FAFC]"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
