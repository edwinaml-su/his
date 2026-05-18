"use client";

/**
 * ECE — Atención Recién Nacido (ATN_RN, NTEC Doc).
 *
 * Muestra lista de registros ATN_RN con filtros por episodio y estado.
 * Formulario de creación con cards Apgar grandes y checklist de alimentación.
 *
 * Roles habilitados: MC.
 * Roles de lectura: MC, ENF, ARCH, DIR.
 */

import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Checkbox } from "@his/ui/components/checkbox";
import { trpc } from "@/lib/trpc/react";

// =============================================================================
// ApgarScoreInput — reutilizable hasta que PR #104 aterrice en esta rama.
// Cuando se mergee, reemplazar por: import { ApgarScoreInput } from "@his/ui/components/apgar-score-input"
// =============================================================================

interface ApgarScoreInputProps {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  required?: boolean;
}

function ApgarScoreInput({ label, value, onChange, required }: ApgarScoreInputProps) {
  const scores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">
        {label}
        {required && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}
      </Label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {scores.map((s) => {
          const isActive = value === s;
          const color =
            s <= 3 ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : s <= 6 ? "bg-yellow-500 text-white hover:bg-yellow-400"
            : "bg-green-600 text-white hover:bg-green-500";
          return (
            <button
              key={s}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(s)}
              className={[
                "h-10 w-10 rounded-full text-sm font-bold transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? `${color} ring-2 ring-offset-2 ring-ring scale-110 shadow-md` : "bg-muted text-muted-foreground hover:bg-muted/70",
              ].join(" ")}
            >
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const dtFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "short", timeStyle: "short" });

const ESTADO_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  borrador: { label: "Borrador",  variant: "secondary" },
  firmado:  { label: "Firmado",   variant: "default" },
  validado: { label: "Validado",  variant: "default" },
  anulado:  { label: "Anulado",   variant: "destructive" },
};

function EstadoBadge({ estado }: { estado: string }) {
  const cfg = ESTADO_MAP[estado] ?? { label: estado, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

const ALIMENTACION_OPTIONS = [
  { value: "lactancia_inmediata", label: "Lactancia inmediata" },
  { value: "formula",            label: "Fórmula" },
  { value: "sng",                label: "SNG" },
] as const;

type AlimentacionValue = typeof ALIMENTACION_OPTIONS[number]["value"];

// =============================================================================
// Página principal
// =============================================================================

export default function AtencionRnPage() {
  // Filtros listado
  const [episodioId, setEpisodioId] = React.useState("");
  const [estadoFiltro, setEstadoFiltro] = React.useState<"todos" | "borrador" | "firmado" | "validado" | "anulado">("todos");

  // Formulario
  const [showForm, setShowForm]  = React.useState(false);
  const [apgar1, setApgar1]      = React.useState<number | undefined>(undefined);
  const [apgar5, setApgar5]      = React.useState<number | undefined>(undefined);
  const [apgar10, setApgar10]    = React.useState<number | undefined>(undefined);
  const [alimentacion, setAlimentacion] = React.useState<AlimentacionValue>("lactancia_inmediata");
  const [reanimacion, setReanimacion]   = React.useState(false);
  const [nrp, setNrp]           = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [formSuccess, setFormSuccess] = React.useState<string | null>(null);

  // Form refs
  const episodioRef      = React.useRef<HTMLInputElement>(null);
  const madreIdRef       = React.useRef<HTMLInputElement>(null);
  const nombreRef        = React.useRef<HTMLInputElement>(null);
  const apellidoRef      = React.useRef<HTMLInputElement>(null);
  const sexIdRef         = React.useRef<HTMLInputElement>(null);
  const birthDateRef     = React.useRef<HTMLInputElement>(null);
  const pesoRef          = React.useRef<HTMLInputElement>(null);
  const tallaRef         = React.useRef<HTMLInputElement>(null);
  const pcRef            = React.useRef<HTMLInputElement>(null);
  const sexoRef          = React.useRef<HTMLSelectElement>(null);
  const egRef            = React.useRef<HTMLInputElement>(null);

  const query = trpc.eceAtencionRn.list.useQuery({
    episodioObsId: episodioId.trim() || undefined,
    estado: estadoFiltro === "todos" ? undefined : estadoFiltro,
    limit: 20,
  });

  const createMutation = trpc.eceAtencionRn.create.useMutation({
    onSuccess: (data) => {
      setFormSuccess(`Registro ATN_RN creado. ID: ${data.id}. Paciente RN: ${data.pacienteRnId}`);
      setFormError(null);
      setShowForm(false);
      void query.refetch();
    },
    onError: (err) => {
      setFormError(err.message);
      setFormSuccess(null);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (apgar1 === undefined || apgar5 === undefined) {
      setFormError("Apgar 1 min y 5 min son obligatorios.");
      return;
    }

    createMutation.mutate({
      episodioObsId:           episodioRef.current?.value.trim() ?? "",
      pacienteMadreId:         madreIdRef.current?.value.trim() ?? "",
      rnPrimerNombre:          nombreRef.current?.value.trim() ?? "",
      rnPrimerApellido:        apellidoRef.current?.value.trim() ?? "",
      rnBiologicalSexId:       sexIdRef.current?.value.trim() ?? "",
      rnBirthDate:             new Date(birthDateRef.current?.value ?? ""),
      pesoG:                   Number(pesoRef.current?.value ?? 0),
      tallaCm:                 Number(tallaRef.current?.value ?? 0),
      perimetroCefalicoCm:     pcRef.current?.value ? Number(pcRef.current.value) : undefined,
      sexo:                    (sexoRef.current?.value ?? "I") as "M" | "F" | "I",
      edadGestacionalSemanas:  Number(egRef.current?.value ?? 0),
      apgar1min:               apgar1,
      apgar5min:               apgar5,
      apgar10min:              apgar10,
      reanimacionRequerida:    reanimacion,
      reanimacionProtocoloNrp: nrp,
      alimentacionInicial:     alimentacion,
    });
  }

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Atención Recién Nacido</h1>
          <p className="text-sm text-muted-foreground">
            Registro NTEC Doc ATN_RN — sala de expulsión / maternidad.
          </p>
        </div>
        <Button onClick={() => { setShowForm((v) => !v); setFormError(null); setFormSuccess(null); }}>
          {showForm ? "Cancelar" : "Nuevo registro"}
        </Button>
      </div>

      {/* Mensajes globales */}
      {formSuccess && (
        <p role="status" className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">
          {formSuccess}
        </p>
      )}

      {/* Formulario de creación */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Nuevo registro ATN_RN</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6" noValidate>
              {formError && (
                <p role="alert" className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
                  {formError}
                </p>
              )}

              {/* Contexto clínico */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Contexto clínico
                </legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="episodio-obs-id">Episodio Obs (UUID) *</Label>
                    <Input id="episodio-obs-id" ref={episodioRef} required className="font-mono text-sm"
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="madre-id">Paciente madre (UUID ECE) *</Label>
                    <Input id="madre-id" ref={madreIdRef} required className="font-mono text-sm"
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                  </div>
                </div>
              </fieldset>

              {/* Datos paciente RN */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Datos paciente RN (creación automática)
                </legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rn-nombre">Primer nombre *</Label>
                    <Input id="rn-nombre" ref={nombreRef} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rn-apellido">Primer apellido *</Label>
                    <Input id="rn-apellido" ref={apellidoRef} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rn-birth-date">Fecha de nacimiento *</Label>
                    <Input id="rn-birth-date" ref={birthDateRef} type="datetime-local" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rn-sex-id">BiologicalSex ID (UUID) *</Label>
                    <Input id="rn-sex-id" ref={sexIdRef} required className="font-mono text-sm"
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                  </div>
                </div>
              </fieldset>

              {/* Datos clínicos */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Datos clínicos del neonato
                </legend>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="peso">Peso (g) *</Label>
                    <Input id="peso" ref={pesoRef} type="number" min={200} max={8000} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="talla">Talla (cm) *</Label>
                    <Input id="talla" ref={tallaRef} type="number" step="0.1" min={20} max={70} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pc">Perímetro cefálico (cm)</Label>
                    <Input id="pc" ref={pcRef} type="number" step="0.1" min={20} max={50} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="eg">Edad gestacional (sem) *</Label>
                    <Input id="eg" ref={egRef} type="number" min={20} max={45} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sexo">Sexo *</Label>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <select id="sexo" ref={sexoRef as any}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                      <option value="M">Masculino</option>
                      <option value="F">Femenino</option>
                      <option value="I">Indeterminado</option>
                    </select>
                  </div>
                </div>
              </fieldset>

              {/* Apgar cards grandes */}
              <fieldset className="space-y-4">
                <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Escalas Apgar
                </legend>
                <div className="flex flex-wrap gap-8">
                  <ApgarScoreInput
                    label="Apgar 1 min"
                    value={apgar1}
                    onChange={setApgar1}
                    required
                  />
                  <ApgarScoreInput
                    label="Apgar 5 min"
                    value={apgar5}
                    onChange={setApgar5}
                    required
                  />
                  <ApgarScoreInput
                    label="Apgar 10 min"
                    value={apgar10}
                    onChange={setApgar10}
                  />
                </div>
              </fieldset>

              {/* Reanimación */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Reanimación
                </legend>
                <div className="flex flex-wrap gap-6">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="reanimacion"
                      checked={reanimacion}
                      onCheckedChange={(v) => setReanimacion(Boolean(v))}
                    />
                    <Label htmlFor="reanimacion">Reanimación requerida</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="nrp"
                      checked={nrp}
                      disabled={!reanimacion}
                      onCheckedChange={(v) => setNrp(Boolean(v))}
                    />
                    <Label htmlFor="nrp" className={!reanimacion ? "text-muted-foreground" : ""}>
                      Protocolo NRP aplicado
                    </Label>
                  </div>
                </div>
              </fieldset>

              {/* Alimentación */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Alimentación inicial
                </legend>
                <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Alimentación inicial">
                  {ALIMENTACION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={alimentacion === opt.value}
                      onClick={() => setAlimentacion(opt.value)}
                      className={[
                        "rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        alimentacion === opt.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background hover:bg-accent",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Guardando…" : "Guardar ATN_RN"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filtros listado */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="w-72 space-y-1.5">
            <Label htmlFor="filtro-episodio">Episodio Obs (UUID)</Label>
            <Input
              id="filtro-episodio"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={episodioId}
              onChange={(e) => setEpisodioId(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor="filtro-estado">Estado</Label>
            <Select value={estadoFiltro} onValueChange={(v) => setEstadoFiltro(v as typeof estadoFiltro)}>
              <SelectTrigger id="filtro-estado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="borrador">Borrador</SelectItem>
                <SelectItem value="firmado">Firmado</SelectItem>
                <SelectItem value="validado">Validado</SelectItem>
                <SelectItem value="anulado">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de registros */}
      <Card>
        <CardHeader>
          <CardTitle>Registros ATN_RN</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">{query.error.message}</p>
          )}
          {!query.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin registros para los filtros actuales.</p>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hora nac.</TableHead>
                  <TableHead>Peso (g)</TableHead>
                  <TableHead>EG (sem)</TableHead>
                  <TableHead>Apgar 1&apos;</TableHead>
                  <TableHead>Apgar 5&apos;</TableHead>
                  <TableHead>Alimentación</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">
                      {dtFmt.format(new Date(r.hora_nacimiento))}
                    </TableCell>
                    <TableCell className="tabular-nums">{r.peso_g}</TableCell>
                    <TableCell className="tabular-nums">{r.edad_gestacional_semanas}</TableCell>
                    <TableCell className="tabular-nums font-bold">
                      <span className={
                        r.apgar_1min <= 3 ? "text-destructive"
                        : r.apgar_1min <= 6 ? "text-yellow-600"
                        : "text-green-700"
                      }>
                        {r.apgar_1min}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums font-bold">
                      <span className={
                        (r.apgar_5min ?? 0) <= 3 ? "text-destructive"
                        : (r.apgar_5min ?? 0) <= 6 ? "text-yellow-600"
                        : "text-green-700"
                      }>
                        {r.apgar_5min ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>{r.alimentacion_inicial}</TableCell>
                    <TableCell>
                      <EstadoBadge estado={r.estado_documento} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
