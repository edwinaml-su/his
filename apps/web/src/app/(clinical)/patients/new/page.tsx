"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@his/ui/components/switch";
import { cn } from "@his/ui/lib/utils";
import { ScanLine, TriangleAlert, Check, Info, Droplet, ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc/react";
import { calcularEdad } from "@/lib/edad";
import { mascaraFechaDDMMAAAA, parseFechaDDMMAAAA } from "@/lib/fecha-ddmmaaaa";
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

// CC-0008b — 12 combinaciones ABO+Rh (incluye "Du", variante débil) + "no
// reportado en documento de identificación" (fiel al <select id="sangre"> del
// mockup preregistro2.html L463-478).
const SANGRE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Selecciona…" },
  { value: "A+", label: "A+" },
  { value: "A-", label: "A-" },
  { value: "A Du", label: "A Du" },
  { value: "B+", label: "B+" },
  { value: "B-", label: "B-" },
  { value: "B Du", label: "B Du" },
  { value: "AB+", label: "AB+" },
  { value: "AB-", label: "AB-" },
  { value: "AB Du", label: "AB Du" },
  { value: "O+", label: "O+" },
  { value: "O-", label: "O-" },
  { value: "O Du", label: "O Du" },
  { value: "NR", label: "No reportado en documento de identificación" },
];

type BloodPayload = {
  bloodTypeAbo?: "A" | "B" | "AB" | "O";
  bloodRh?: "+" | "-" | "Du";
  bloodTypeNotReported?: boolean;
};

/** Divide el valor combinado del <select> ("A Du", "O+", "NR"...) al payload del contrato. */
function mapSangreToPayload(sangre: string): BloodPayload {
  if (!sangre) return {};
  if (sangre === "NR") return { bloodTypeNotReported: true };
  const isDu = sangre.endsWith(" Du");
  const abo = (isDu ? sangre.slice(0, -3) : sangre.slice(0, -1)) as "A" | "B" | "AB" | "O";
  const rh = (isDu ? "Du" : sangre.slice(-1)) as "+" | "-" | "Du";
  return { bloodTypeAbo: abo, bloodRh: rh };
}

/**
 * CC-0008b — Banner permanente de seguridad (tipo de sangre). Verde SOLO si
 * hay documento presentado, el paciente está identificado y hay un valor
 * concreto (el tipo confiable proviene del documento). Textos literales del
 * mockup L629-652 (`actualizarBannerSangre`).
 */
function bannerSangreState(f: {
  traeDocumento: boolean;
  noId: boolean;
  sangre: string;
}): { ok: boolean; value: string } {
  const concreto = Boolean(f.sangre) && f.sangre !== "NR";
  const ok = f.traeDocumento && !f.noId && concreto;
  if (ok) return { ok: true, value: f.sangre };

  let value: string;
  if (f.noId) value = "Paciente no identificado — tipo de sangre desconocido";
  else if (!f.traeDocumento) value = "Sin documento — tipo de sangre no identificado";
  else if (f.sangre === "NR") value = "No reportado en documento de identificación";
  else value = "Sin registrar";
  return { ok: false, value };
}

// Chip de radio con indicador de punto, fiel a la paleta del mockup CC-0008.
function Chip({
  name,
  value,
  checked,
  captured,
  disabled,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  captured?: boolean;
  disabled?: boolean;
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
        disabled && "cursor-not-allowed opacity-60 hover:border-[#C6D0DB]",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
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
 * Pre-registro de paciente (CC-0008 / REQ-ECE-PRE-001; CC-0008b: tipo de
 * sangre + paciente no identificado).
 *
 * Alta inicial asistida por escaneo de documento: tipo de documento primero,
 * switch "¿trae documento?", nombres/apellidos extendidos, sexo biológico por
 * radio y edad derivada (no persistida). El expediente {PAIS}{AA}{NNNNN} se
 * genera en servidor (CC-0002); el MRN ya no se captura (autogenerado).
 *
 * CC-0008b agrega: banner permanente de tipo de sangre (obtenido del
 * documento), y el switch "Paciente no identificado" (emergencia) que genera
 * una identidad temporal (nombre + código DDMMAAAA-NN) resuelta en servidor.
 *
 * Paleta y layout fieles al mockup docs/CC/0008/preregistro2.html (navy/teal/ámbar).
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

  const [created, setCreated] = React.useState<{
    id: string;
    expediente: string | null;
    unknownLabel: string | null;
  } | null>(null);

  const create = trpc.patient.create.useMutation({
    onSuccess: (p) =>
      setCreated({
        id: p.id,
        expediente: p.expediente ?? null,
        unknownLabel: p.unknownLabel ?? null,
      }),
  });

  // CC-0008b — al guardar el pre-registro se ejecuta automáticamente la
  // orientación táctil (/orientacion): cuenta regresiva visible para que el
  // operador alcance a leer el expediente antes del salto automático.
  const ORIENTACION_DELAY_S = 6;
  const [orientacionEn, setOrientacionEn] = React.useState(ORIENTACION_DELAY_S);
  React.useEffect(() => {
    if (!created) return;
    setOrientacionEn(ORIENTACION_DELAY_S);
    // El updater debe ser PURO: React puede re-ejecutarlo (y en StrictMode lo
    // hace dos veces). Antes el `router.push` vivía aquí dentro y funcionaba
    // por casualidad en React 18; con React 19 dejó de dispararse de forma
    // fiable y el paciente se quedaba atrapado en el panel de éxito. La
    // navegación pasa al efecto de abajo, que reacciona al estado.
    const iv = setInterval(() => {
      setOrientacionEn((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created]);

  React.useEffect(() => {
    if (!created || orientacionEn !== 0) return;
    router.push("/orientacion");
  }, [created, orientacionEn, router]);

  const [form, setForm] = React.useState({
    traeDocumento: true,
    noId: false, // CC-0008b — "Paciente no identificado" (emergencia).
    tipoDocumento: "DUI" as DocTipoUI,
    numeroDocumento: "",
    primerNombre: "",
    segundoNombre: "",
    tercerNombre: "",
    primerApellido: "",
    segundoApellido: "",
    apellidoCasada: "",
    biologicalSexId: "",
    fechaNacimiento: "", // DD/MM/AAAA (texto con máscara, fiel al mockup)
    sangre: "", // combinado ABO+Rh o 'NR'
  });

  type CampoCapturable =
    | "numeroDocumento"
    | "primerNombre"
    | "segundoNombre"
    | "tercerNombre"
    | "primerApellido"
    | "segundoApellido"
    | "apellidoCasada"
    | "biologicalSexId"
    | "fechaNacimiento"
    | "sangre";

  // Campos poblados por escaneo (resaltado teal + aviso de verificación).
  const [captured, setCaptured] = React.useState<Set<CampoCapturable>>(new Set());

  // CC-0008b — código de fecha+correlativo mostrado en el panel de identidad
  // temporal MIENTRAS se edita el formulario. Es informativo: el correlativo
  // real (unknownLabel) lo asigna el servidor y se muestra en el panel de éxito.
  const [noIdCodigoPreview, setNoIdCodigoPreview] = React.useState<string | null>(null);

  const [validationError, setValidationError] = React.useState<{
    field: string | null;
    message: string;
  }>({ field: null, message: "" });

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

  // §8/CC-0008b — edad derivada de la fecha DD/MM/AAAA (no persistida). Oculta
  // en modo "no identificado" (fecha desconocida, mismo criterio del mockup).
  const nacimiento = form.noId ? null : parseFechaDDMMAAAA(form.fechaNacimiento);
  const edad = nacimiento && nacimiento <= new Date() ? calcularEdad(nacimiento) : null;

  // CC-0008b — el tipo de sangre proviene del documento: sin documento (o
  // paciente no identificado) se fuerza "No reportado" y se deshabilita el
  // select (mockup toggleDoc() L526-535).
  const sangreDisabled = !form.traeDocumento || form.noId;
  const prevSangreDisabledRef = React.useRef(sangreDisabled);
  React.useEffect(() => {
    const wasDisabled = prevSangreDisabledRef.current;
    if (sangreDisabled && !wasDisabled) {
      setForm((f) => ({ ...f, sangre: "NR" }));
    } else if (!sangreDisabled && wasDisabled) {
      setForm((f) => ({ ...f, sangre: "" }));
    }
    prevSangreDisabledRef.current = sangreDisabled;
  }, [sangreDisabled]);

  // CC-0008b — "Paciente no identificado": apaga y deshabilita "trae
  // documento", limpia la fecha de nacimiento y congela el código de fecha
  // del panel de identidad temporal al momento de activarse (mockup toggleNoId()).
  const setNoId = (on: boolean) => {
    setForm((f) => ({
      ...f,
      noId: on,
      traeDocumento: on ? false : f.traeDocumento,
      fechaNacimiento: on ? "" : f.fechaNacimiento,
    }));
    if (on) {
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      setNoIdCodigoPreview(`${dd}${mm}${d.getFullYear()}-01`);
    }
  };

  // Nombre temporal en vivo (mockup actualizarNombreNoId()): se completa con
  // el sexo biológico seleccionado; sin sexo, invita a seleccionarlo.
  const sexoSeleccionado = sexOptions.find((s) => s.id === form.biologicalSexId);
  const generoTexto =
    sexoSeleccionado?.code === "M" ? "masculino" : sexoSeleccionado?.code === "F" ? "femenino" : null;
  const noIdCodigo = noIdCodigoPreview ?? "00000000-01";
  const noIdNombrePreview = generoTexto
    ? `Paciente ${generoTexto} no identificado ${noIdCodigo}`
    : `Paciente no identificado ${noIdCodigo} — seleccione sexo biológico`;

  const banner = bannerSangreState(form);

  // Clase de input fiel al mockup: borde fuerte sobre field-bg, foco teal,
  // captura teal y error rojo.
  const fieldCls = (key: CampoCapturable, invalid?: boolean) =>
    cn(
      "w-full rounded-lg border bg-[#F8FAFC] px-[13px] py-[11px] text-sm text-[#15212E] outline-none transition-colors placeholder:text-[#9AA8B6] focus:border-[#00A8B5] focus:bg-white focus:ring-[3px] focus:ring-[#00A8B5]/20",
      captured.has(key) ? "border-[#00A8B5] bg-[#E6F7F8]" : "border-[#C6D0DB]",
      invalid && "border-[#DC2626] focus:border-[#DC2626]",
    );

  // §7/CC-0008b — escaneo simulado: puebla campos (incl. tipo de sangre) y los
  // marca como capturados.
  const onScan = () => {
    const d = parseDocumento("", PARSER_TIPO[form.tipoDocumento]);
    const sexId =
      sexOptions.find((s) => s.code === SEXO_CODE[d.sexoBiologico])?.id ?? form.biologicalSexId;
    const [yyyy, mm, dd] = d.fechaNacimiento.split("-");

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
      fechaNacimiento: `${dd}/${mm}/${yyyy}`,
      sangre: d.tipoSangre,
    }));

    const marcados = new Set<CampoCapturable>([
      "numeroDocumento",
      "primerNombre",
      "primerApellido",
      "sangre",
    ]);
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

    if (!form.noId) {
      if (!form.primerNombre.trim()) {
        return setValidationError({ field: "primerNombre", message: "Ingresa el primer nombre." });
      }
      if (!form.primerApellido.trim()) {
        return setValidationError({
          field: "primerApellido",
          message: "Ingresa el primer apellido.",
        });
      }
    }
    if (!form.biologicalSexId) {
      return setValidationError({
        field: "sexoBiologico",
        message: "Selecciona el sexo biológico — campo obligatorio para protocolos clínicos.",
      });
    }

    let birthDate: Date | null = null;
    if (!form.noId) {
      if (!form.fechaNacimiento) {
        return setValidationError({
          field: "fechaNacimiento",
          message: "Ingresa la fecha de nacimiento — requerida para generar el expediente.",
        });
      }
      birthDate = parseFechaDDMMAAAA(form.fechaNacimiento);
      if (!birthDate) {
        return setValidationError({
          field: "fechaNacimiento",
          message: "Fecha de nacimiento inválida. Usa el formato DD/MM/AAAA.",
        });
      }
      if (birthDate > new Date()) {
        return setValidationError({
          field: "fechaNacimiento",
          message: "La fecha de nacimiento no puede ser futura.",
        });
      }
    }

    // §6 — documento obligatorio solo cuando el paciente lo trae (y está identificado).
    if (form.traeDocumento && !form.noId) {
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

    // CC-0008b — tipo de sangre obligatorio; cuando está deshabilitado ya
    // viene forzado a 'NR' (sin documento / no identificado).
    if (!form.sangre) {
      return setValidationError({
        field: "sangre",
        message: "Selecciona el tipo de sangre.",
      });
    }

    setValidationError({ field: null, message: "" });

    create.mutate({
      firstName: form.noId ? undefined : form.primerNombre.trim(),
      middleName: form.noId ? undefined : form.segundoNombre.trim() || undefined,
      thirdName: form.noId ? undefined : form.tercerNombre.trim() || undefined,
      lastName: form.noId ? undefined : form.primerApellido.trim(),
      secondLastName: form.noId ? undefined : form.segundoApellido.trim() || undefined,
      marriedLastName: form.noId ? undefined : form.apellidoCasada.trim() || undefined,
      biologicalSexId: form.biologicalSexId,
      birthDate: birthDate ?? undefined,
      birthDateEstimated: false,
      isUnknown: form.noId,
      traeDocumento: form.noId ? false : form.traeDocumento,
      documentType: form.traeDocumento && !form.noId ? form.tipoDocumento : undefined,
      documentNumber: form.traeDocumento && !form.noId ? form.numeroDocumento.trim() : undefined,
      ...mapSangreToPayload(form.sangre),
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
            {created.unknownLabel && (
              <p className="text-sm text-[#5B6B7B]">
                Identidad temporal:{" "}
                <span className="font-semibold text-[#15212E]">{created.unknownLabel}</span>
              </p>
            )}
            <p className="text-sm text-[#5B6B7B]" aria-live="polite">
              Abriendo la orientación táctil en{" "}
              <span className="font-semibold text-[#15212E]">{orientacionEn} s</span>…
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => router.push("/orientacion")}
                className="rounded-lg bg-[#0B3D5C] px-[26px] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0E4A6E]"
              >
                Ir a orientación ahora
              </button>
              <button
                type="button"
                onClick={() => router.push(`/patients/${created.id}`)}
                className="rounded-lg border-[1.5px] border-[#0B3D5C] bg-white px-[26px] py-3 text-sm font-semibold text-[#0B3D5C] transition-colors hover:bg-[#F0F5FC]"
              >
                Ver expediente del paciente
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const scanned = captured.size > 0;
  const showDocBlock = form.traeDocumento && !form.noId;
  const showManualNote = !form.traeDocumento && !form.noId;

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

        {/* Banner permanente de seguridad: tipo de sangre */}
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "mb-[22px] flex items-center gap-3 rounded-lg border px-4 py-[13px] text-sm font-semibold",
            banner.ok
              ? "border-[#12B76A] bg-[#E7F6EC] text-[#027A48]"
              : "border-[#E5484D] bg-[#FDECEC] text-[#B42318]",
          )}
        >
          {banner.ok ? (
            <Droplet className="h-[22px] w-[22px] shrink-0" aria-hidden />
          ) : (
            <TriangleAlert className="h-[22px] w-[22px] shrink-0" aria-hidden />
          )}
          <span>
            <span className="font-bold">Tipo de sangre:</span> {banner.value}
          </span>
        </div>

        <form onSubmit={onSubmit}>
          {/* §6 — switch ¿trae documento? (default ON) */}
          <div className="mb-6 flex items-start gap-[14px] rounded-lg border border-[#DDE3EA] bg-[#F8FAFC] px-[18px] py-4">
            <Switch
              id="traeDocumento"
              checked={form.traeDocumento}
              disabled={form.noId}
              onCheckedChange={(v) => setForm((f) => ({ ...f, traeDocumento: v }))}
              className={cn("mt-0.5", form.traeDocumento && "bg-[#00A8B5]")}
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

          {/* CC-0008b — switch "Paciente no identificado" (emergencia) */}
          <div className="mb-6 flex items-start gap-[14px] rounded-lg border border-[#DDE3EA] bg-[#F8FAFC] px-[18px] py-4">
            <Switch
              id="noId"
              checked={form.noId}
              onCheckedChange={setNoId}
              className={cn("mt-0.5", form.noId && "bg-[#E8A317]")}
            />
            <div>
              <label htmlFor="noId" className="block text-sm font-semibold text-[#15212E]">
                Paciente no identificado
              </label>
              <span className="mt-0.5 block text-[12.5px] text-[#5B6B7B]">
                Emergencia: paciente inconsciente, sin identificación y sin acompañante. Genera
                una identidad temporal (nombre + código de fecha y correlativo).
              </span>
            </div>
          </div>

          {/* Aviso de captura manual cuando NO trae documento (y está identificado) */}
          {showManualNote && (
            <div
              role="note"
              className="mb-[22px] flex items-center gap-[9px] rounded-lg border border-[#F4D9A6] bg-[#FEF6E7] px-[14px] py-3 text-[13px] text-[#92520E]"
            >
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              Captura manual — el paciente no presenta documento. Ingrese los datos de
              identificación a mano.
            </div>
          )}

          {/* §4/§5 — bloque de documento (tipo primero), solo si trae documento e identificado */}
          {showDocBlock && (
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

          {/* CC-0008b — identidad temporal (paciente no identificado) */}
          {form.noId && (
            <div className="mb-5 rounded-lg border border-[#E8A317] bg-[#FFF7E8] px-[18px] py-4">
              <div className="mb-3 flex items-center gap-[9px] text-sm font-bold text-[#92520E]">
                <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden />
                Nombre asignado (paciente no identificado)
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#B07A2E]">
                    Nombre
                  </span>
                  <strong className="text-base font-bold text-[#0B3D5C]">{noIdNombrePreview}</strong>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#B07A2E]">
                    Código de fecha y correlativo
                  </span>
                  <strong className="text-base font-bold text-[#0B3D5C]">{noIdCodigo}</strong>
                </div>
              </div>
              <p className="mt-3 text-[12.5px] leading-[1.5] text-[#92520E]">
                El nombre se compone con la <b>fecha de hoy</b> (DDMMAAAA) y un{" "}
                <b>correlativo</b> del día, y se completa con el <b>sexo biológico</b>{" "}
                seleccionado abajo. La identidad real se captura después en <b>Admisión</b>.
              </p>
            </div>
          )}

          {!form.noId && (
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
          )}

          {!form.noId && (
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
          )}

          {/* CC-0008b — tipo de sangre (banner permanente arriba refleja este valor) */}
          <div className="mb-[18px]">
            <label htmlFor="sangre" className="mb-2 block text-[13px] font-semibold text-[#15212E]">
              Tipo de sangre <span className="ml-0.5 text-[#DC2626]">*</span>
            </label>
            <div className="relative max-w-[460px]">
              <select
                id="sangre"
                value={form.sangre}
                disabled={sangreDisabled}
                onChange={(e) => setField("sangre", e.target.value)}
                aria-invalid={validationError.field === "sangre"}
                className={cn(
                  fieldCls("sangre", validationError.field === "sangre"),
                  "w-full appearance-none pr-10",
                  sangreDisabled && "cursor-not-allowed bg-[#EDF1F5] text-[#7A8794] opacity-85",
                )}
              >
                {SANGRE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B6B7B]"
                aria-hidden
              />
            </div>
            {validationError.field === "sangre" && (
              <p role="alert" className="mt-1.5 text-sm text-[#DC2626]">
                {validationError.message}
              </p>
            )}
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#5B6B7B]">
              <Info className="h-3 w-3 shrink-0" aria-hidden />
              Se obtiene del documento (DUI) al escanear. Si el documento no lo reporta,
              seleccione «No reportado en documento de identificación».
            </p>
          </div>

          {/* §10/AC3 — sexo biológico como radio (siempre visible, incl. no identificado) */}
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

          {/* §5 — fecha de nacimiento (texto con máscara DD/MM/AAAA) + §8 edad derivada */}
          {!form.noId && (
            <div className="mb-[18px]">
              <label htmlFor="fechaNacimiento" className="mb-2 block text-[13px] font-semibold text-[#15212E]">
                Fecha de nacimiento <span className="ml-0.5 text-[#DC2626]">*</span>
              </label>
              <div className="flex flex-wrap items-center gap-[14px]">
                <input
                  id="fechaNacimiento"
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="DD/MM/AAAA"
                  value={form.fechaNacimiento}
                  onChange={(e) => setField("fechaNacimiento", mascaraFechaDDMMAAAA(e.target.value))}
                  className={cn(
                    fieldCls("fechaNacimiento", validationError.field === "fechaNacimiento"),
                    "max-w-[200px]",
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
              {/* Fiel al mockup: fnacHint solo se muestra cuando el documento aplica (toggleDoc()). */}
              {showDocBlock && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#5B6B7B]">
                  <Info className="h-3 w-3 shrink-0" aria-hidden />
                  Formato DD/MM/AAAA. Se obtiene del documento al escanear; la edad se calcula
                  automáticamente con la fecha de hoy.
                </p>
              )}
            </div>
          )}

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
