"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { Switch } from "@his/ui/components/switch";
import { cn } from "@his/ui/lib/utils";
import { ScanLine, TriangleAlert, Sparkles } from "lucide-react";
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

/**
 * Pre-registro de paciente (CC-0008 / REQ-ECE-PRE-001).
 *
 * Alta inicial asistida por escaneo de documento: tipo de documento primero,
 * switch "¿trae documento?", nombres/apellidos extendidos, sexo biológico por
 * radio y edad derivada (no persistida). El expediente {PAIS}{AA}{NNNNN} se
 * genera en servidor (CC-0002); el MRN ya no se captura (autogenerado).
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

  const capCls = (key: CampoCapturable) =>
    captured.has(key) ? "border-primary ring-1 ring-primary/50 bg-primary/5" : "";

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
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Pre-registro</h1>
        <Card>
          <CardContent className="pt-6">
            <div role="status" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Paciente registrado.{" "}
                {created.expediente ? (
                  <span className="font-semibold">Expediente: {created.expediente}</span>
                ) : null}
              </p>
              <Button onClick={() => router.push(`/patients/${created.id}`)}>
                Ver expediente del paciente
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const scanned = captured.size > 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Pre-registro</h1>
      <Card>
        <CardHeader>
          <CardTitle>Datos de identificación</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit}>
            {/* §6 — switch ¿trae documento? (default ON) */}
            <FormField>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="traeDocumento" className="font-normal">
                  El paciente trae documento de identidad
                </Label>
                <Switch
                  id="traeDocumento"
                  checked={form.traeDocumento}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, traeDocumento: v }))}
                />
              </div>
            </FormField>

            {/* Aviso de captura manual cuando NO trae documento */}
            {!form.traeDocumento && (
              <p
                role="note"
                className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
              >
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                Captura manual — el paciente no presenta documento. Ingrese los datos de
                identificación a mano.
              </p>
            )}

            {/* §4/§5 — bloque de documento (tipo primero), solo si trae documento */}
            {form.traeDocumento && (
              <fieldset className="space-y-4 rounded-lg border p-4">
                <legend className="px-1 text-sm font-semibold">Documento</legend>

                <FormField>
                  <Label>
                    Tipo de documento <span aria-hidden className="text-destructive">*</span>
                    <span className="sr-only"> (obligatorio)</span>
                  </Label>
                  <div role="radiogroup" aria-label="Tipo de documento" className="flex flex-wrap gap-2">
                    {(Object.keys(TIPO_LABEL) as DocTipoUI[]).map((t) => (
                      <label
                        key={t}
                        className={cn(
                          "cursor-pointer rounded-lg border px-4 py-2 text-sm transition-colors",
                          form.tipoDocumento === t
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input hover:bg-accent",
                        )}
                      >
                        <input
                          type="radio"
                          name="tipoDocumento"
                          value={t}
                          checked={form.tipoDocumento === t}
                          onChange={() => setForm((f) => ({ ...f, tipoDocumento: t }))}
                          className="sr-only"
                        />
                        {TIPO_LABEL[t]}
                      </label>
                    ))}
                  </div>
                </FormField>

                <FormField>
                  <Label htmlFor="numeroDocumento">
                    Número de Documento <span aria-hidden className="text-destructive">*</span>
                    <span className="sr-only"> (obligatorio)</span>
                  </Label>
                  <Input
                    id="numeroDocumento"
                    value={form.numeroDocumento}
                    onChange={(e) => setField("numeroDocumento", e.target.value)}
                    className={capCls("numeroDocumento")}
                    aria-invalid={validationError.field === "numeroDocumento"}
                    aria-describedby={
                      validationError.field === "numeroDocumento" ? "numeroDocumento-error" : undefined
                    }
                  />
                  {validationError.field === "numeroDocumento" && (
                    <p id="numeroDocumento-error" role="alert" className="text-sm text-destructive">
                      {validationError.message}
                    </p>
                  )}
                </FormField>

                <Button type="button" variant="secondary" onClick={onScan} className="gap-2">
                  <ScanLine className="h-4 w-4" aria-hidden />
                  Escanear documento (QR / código de barras)
                </Button>

                {scanned && (
                  <p
                    role="status"
                    className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-foreground"
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    Datos obtenidos del documento. Verifique antes de continuar.
                  </p>
                )}
              </fieldset>
            )}

            {/* §5/§9 — Nombres (hasta 3) */}
            <FormField>
              <Label htmlFor="primerNombre">
                Primer nombre <span aria-hidden className="text-destructive">*</span>
                <span className="sr-only"> (obligatorio)</span>
              </Label>
              <Input
                id="primerNombre"
                value={form.primerNombre}
                onChange={(e) => setField("primerNombre", e.target.value)}
                className={capCls("primerNombre")}
                aria-invalid={validationError.field === "primerNombre"}
                aria-describedby={validationError.field === "primerNombre" ? "primerNombre-error" : undefined}
              />
              {validationError.field === "primerNombre" && (
                <p id="primerNombre-error" role="alert" className="text-sm text-destructive">
                  {validationError.message}
                </p>
              )}
            </FormField>
            <FormField>
              <Label htmlFor="segundoNombre">Segundo nombre</Label>
              <Input
                id="segundoNombre"
                value={form.segundoNombre}
                onChange={(e) => setField("segundoNombre", e.target.value)}
                className={capCls("segundoNombre")}
              />
            </FormField>
            <FormField>
              <Label htmlFor="tercerNombre">Tercer nombre</Label>
              <Input
                id="tercerNombre"
                value={form.tercerNombre}
                onChange={(e) => setField("tercerNombre", e.target.value)}
                className={capCls("tercerNombre")}
              />
            </FormField>

            {/* §5/§9 — Apellidos (hasta 3, incluye apellido de casada) */}
            <FormField>
              <Label htmlFor="primerApellido">
                Primer apellido <span aria-hidden className="text-destructive">*</span>
                <span className="sr-only"> (obligatorio)</span>
              </Label>
              <Input
                id="primerApellido"
                value={form.primerApellido}
                onChange={(e) => setField("primerApellido", e.target.value)}
                className={capCls("primerApellido")}
                aria-invalid={validationError.field === "primerApellido"}
                aria-describedby={
                  validationError.field === "primerApellido" ? "primerApellido-error" : undefined
                }
              />
              {validationError.field === "primerApellido" && (
                <p id="primerApellido-error" role="alert" className="text-sm text-destructive">
                  {validationError.message}
                </p>
              )}
            </FormField>
            <FormField>
              <Label htmlFor="segundoApellido">Segundo apellido</Label>
              <Input
                id="segundoApellido"
                value={form.segundoApellido}
                onChange={(e) => setField("segundoApellido", e.target.value)}
                className={capCls("segundoApellido")}
              />
            </FormField>
            <FormField>
              <Label htmlFor="apellidoCasada">Apellido de casada (si aplica)</Label>
              <Input
                id="apellidoCasada"
                value={form.apellidoCasada}
                onChange={(e) => setField("apellidoCasada", e.target.value)}
                className={capCls("apellidoCasada")}
              />
            </FormField>

            {/* §10/AC3 — sexo biológico como radio */}
            <FormField>
              <Label>
                Sexo biológico <span aria-hidden className="text-destructive">*</span>
                <span className="sr-only"> (obligatorio)</span>
              </Label>
              <div role="radiogroup" aria-label="Sexo biológico" className="flex flex-wrap gap-2">
                {sexOptions.map((s) => (
                  <label
                    key={s.id}
                    className={cn(
                      "cursor-pointer rounded-lg border px-4 py-2 text-sm transition-colors",
                      form.biologicalSexId === s.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : cn("border-input hover:bg-accent", capCls("biologicalSexId")),
                    )}
                  >
                    <input
                      type="radio"
                      name="sexoBiologico"
                      value={s.id}
                      checked={form.biologicalSexId === s.id}
                      onChange={() => setField("biologicalSexId", s.id)}
                      className="sr-only"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
              {validationError.field === "sexoBiologico" && (
                <p role="alert" className="text-sm text-destructive">
                  {validationError.message}
                </p>
              )}
            </FormField>

            {/* §5 — fecha de nacimiento + §8 edad derivada */}
            <FormField>
              <Label htmlFor="fechaNacimiento">
                Fecha de nacimiento <span aria-hidden className="text-destructive">*</span>
                <span className="sr-only"> (obligatorio)</span>
              </Label>
              <Input
                id="fechaNacimiento"
                type="date"
                max={hoyISO()}
                value={form.fechaNacimiento}
                onChange={(e) => setField("fechaNacimiento", e.target.value)}
                className={capCls("fechaNacimiento")}
                aria-invalid={validationError.field === "fechaNacimiento"}
                aria-describedby={
                  validationError.field === "fechaNacimiento" ? "fechaNacimiento-error" : undefined
                }
              />
              {validationError.field === "fechaNacimiento" && (
                <p id="fechaNacimiento-error" role="alert" className="text-sm text-destructive">
                  {validationError.message}
                </p>
              )}
            </FormField>

            {edad && (
              <FormField>
                <Label>Edad</Label>
                <p
                  data-testid="edad-derivada"
                  className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-foreground"
                >
                  {edad.label}
                </p>
              </FormField>
            )}

            <FormError>{create.error?.message}</FormError>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Guardando…" : "Pre-registrar paciente"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
