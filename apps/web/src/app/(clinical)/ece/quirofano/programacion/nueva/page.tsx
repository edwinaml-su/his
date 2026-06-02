"use client";

/**
 * Nueva Programación Quirúrgica — flujo de creación de orden quirúrgica.
 *
 * Llama a `eceBridgeCirugia.programarCirugia` (transacción atómica):
 *   orden_ingreso → episodio_atencion → episodio_hospitalario → preop_checklist
 *   → reserva_sala_qx → outbox event ece.cirugia.programada.
 *
 * UX: paciente y médicos por BÚSQUEDA DINÁMICA (nombre/identificador), sala QX
 * por SELECTOR de quirófanos (no más UUIDs pegados a mano).
 *
 * Acceso: PHYSICIAN | ADM (validado server-side via requireRole).
 * Hard-stop: sala ocupada en horario propuesto → CONFLICT.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import { trpc } from "@/lib/trpc/react";

// ── Opción genérica para los selectores de búsqueda ──────────────────────────
interface Opt {
  id: string;
  label: string;
  sublabel?: string;
}

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Selector con búsqueda dinámica. Presentacional: el padre maneja la query
 * (debounce + hook tRPC) y pasa las opciones. Al elegir, muestra un chip con
 * botón "Cambiar".
 */
function EntitySearchSelect({
  id,
  label,
  required,
  placeholder,
  hint,
  query,
  onQueryChange,
  options,
  loading,
  selected,
  onSelect,
  onClear,
}: {
  id: string;
  label: string;
  required?: boolean;
  placeholder: string;
  hint?: string;
  query: string;
  onQueryChange: (v: string) => void;
  options: Opt[];
  loading: boolean;
  selected: Opt | null;
  onSelect: (opt: Opt) => void;
  onClear: () => void;
}) {
  const [openList, setOpenList] = React.useState(false);

  if (selected) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>
          {label} {required && <span className="text-destructive">*</span>}
        </Label>
        <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{selected.label}</span>
            {selected.sublabel && (
              <span className="ml-1.5 text-xs text-muted-foreground">{selected.sublabel}</span>
            )}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Cambiar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="relative">
        <Input
          id={id}
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpenList(true);
          }}
          onFocus={() => setOpenList(true)}
          autoComplete="off"
          placeholder={placeholder}
          aria-expanded={openList}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {openList && query.trim().length >= 2 && (
          <ul
            className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-popover py-1 text-sm shadow-md"
            role="listbox"
          >
            {loading && (
              <li className="px-3 py-2 text-muted-foreground">Buscando…</li>
            )}
            {!loading && options.length === 0 && (
              <li className="px-3 py-2 text-muted-foreground">Sin resultados.</li>
            )}
            {options.map((o) => (
              <li key={o.id} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => {
                    onSelect(o);
                    setOpenList(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="min-w-0 truncate">{o.label}</span>
                  {o.sublabel && (
                    <span className="shrink-0 text-xs text-muted-foreground">{o.sublabel}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function toIsoOffset(local: string): string {
  if (!local) return "";
  return `${local}:00-06:00`;
}

export default function NuevaProgramacionPage() {
  const router = useRouter();

  // Entidades seleccionadas (objeto {id,label}) — el payload usa .id.
  const [paciente, setPaciente] = React.useState<Opt | null>(null);
  const [cirujano, setCirujano] = React.useState<Opt | null>(null);
  const [anestesiologo, setAnestesiologo] = React.useState<Opt | null>(null);
  const [salaQxId, setSalaQxId] = React.useState("");

  // Campos simples
  const [procedimientoCie10, setProcedimientoCie10] = React.useState("");
  const [fechaProgramada, setFechaProgramada] = React.useState("");
  const [duracionEstimadaMin, setDuracion] = React.useState(60);
  const [motivoIngreso, setMotivoIngreso] = React.useState("");

  // Queries de búsqueda
  const [qPaciente, setQPaciente] = React.useState("");
  const [qCirujano, setQCirujano] = React.useState("");
  const [qAnest, setQAnest] = React.useState("");
  const dqPaciente = useDebounced(qPaciente);
  const dqCirujano = useDebounced(qCirujano);
  const dqAnest = useDebounced(qAnest);

  const [error, setError] = React.useState<string | null>(null);

  // ── tRPC ──
  const pacienteSearch = trpc.patient.search.useQuery(
    { query: dqPaciente, limit: 8 },
    { enabled: !paciente && dqPaciente.trim().length >= 2, staleTime: 30_000 },
  );
  // userAdmin.listAll: búsqueda por nombre/email. Cast `as any` (convención del repo).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cirujanoSearch = (trpc as any).userAdmin.listAll.useQuery(
    { search: dqCirujano, active: true, pageSize: 8 },
    { enabled: !cirujano && dqCirujano.trim().length >= 2 },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anestSearch = (trpc as any).userAdmin.listAll.useQuery(
    { search: dqAnest, active: true, pageSize: 8 },
    { enabled: !anestesiologo && dqAnest.trim().length >= 2 },
  );
  const roomsQ = trpc.surgery.operatingRoom.list.useQuery({ activeOnly: true, limit: 100 });

  const mutation = trpc.eceBridgeCirugia.programarCirugia.useMutation({
    onSuccess: () => router.push("/ece/quirofano/programacion"),
    onError: (err: { message: string }) =>
      setError(err.message ?? "Error al programar cirugía"),
  });

  // ── Mapeo de opciones ──
  const pacienteOpts: Opt[] = (pacienteSearch.data ?? []).map((p) => ({
    id: p.id,
    label: [p.firstName, p.lastName, p.secondLastName].filter(Boolean).join(" "),
    sublabel: p.mrn ? `#${p.mrn}` : undefined,
  }));
  const toUserOpts = (q: { data?: { items?: { id: string; fullName: string; email: string }[] } }): Opt[] =>
    (q.data?.items ?? []).map((u) => ({ id: u.id, label: u.fullName, sublabel: u.email }));
  const cirujanoOpts = toUserOpts(cirujanoSearch);
  const anestOpts = toUserOpts(anestSearch);
  const rooms = (roomsQ.data ?? []) as { id: string; code: string; name: string }[];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!paciente || !cirujano || !anestesiologo || !salaQxId || !procedimientoCie10.trim() || !fechaProgramada) {
      setError("Completa paciente, procedimiento, fecha, cirujano, anestesiólogo y sala.");
      return;
    }

    mutation.mutate({
      pacienteId: paciente.id,
      procedimientoCie10: procedimientoCie10.trim(),
      fechaProgramada: toIsoOffset(fechaProgramada),
      cirujanoId: cirujano.id,
      anestesiologoId: anestesiologo.id,
      salaQxId,
      duracionEstimadaMin,
      ...(motivoIngreso.trim() ? { motivoIngreso: motivoIngreso.trim() } : {}),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Nueva Programación Quirúrgica</h1>
          <p className="text-sm text-muted-foreground">
            Crea orden + episodio + preop checklist + reserva de sala en una
            única transacción atómica.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/ece/quirofano/programacion">Cancelar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la cirugía</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <EntitySearchSelect
                id="paciente"
                label="Paciente"
                required
                placeholder="Buscar por nombre o expediente…"
                hint="Escribe ≥2 caracteres para buscar."
                query={qPaciente}
                onQueryChange={setQPaciente}
                options={pacienteOpts}
                loading={pacienteSearch.isFetching}
                selected={paciente}
                onSelect={setPaciente}
                onClear={() => {
                  setPaciente(null);
                  setQPaciente("");
                }}
              />

              <div className="space-y-1.5">
                <Label htmlFor="cie10">
                  Procedimiento CIE-10 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cie10"
                  value={procedimientoCie10}
                  onChange={(e) => setProcedimientoCie10(e.target.value.toUpperCase())}
                  required
                  maxLength={20}
                  placeholder="K35.80"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fecha">
                  Fecha y hora programada <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="fecha"
                  type="datetime-local"
                  value={fechaProgramada}
                  onChange={(e) => setFechaProgramada(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Zona horaria: America/El_Salvador (UTC-06:00).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="duracion">
                  Duración estimada (min) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="duracion"
                  type="number"
                  min={1}
                  max={1440}
                  value={duracionEstimadaMin}
                  onChange={(e) => setDuracion(Number(e.target.value) || 60)}
                  required
                />
              </div>

              <EntitySearchSelect
                id="cirujano"
                label="Cirujano"
                required
                placeholder="Buscar por nombre o email…"
                query={qCirujano}
                onQueryChange={setQCirujano}
                options={cirujanoOpts}
                loading={Boolean(cirujanoSearch.isFetching)}
                selected={cirujano}
                onSelect={setCirujano}
                onClear={() => {
                  setCirujano(null);
                  setQCirujano("");
                }}
              />

              <EntitySearchSelect
                id="anestesiologo"
                label="Anestesiólogo"
                required
                placeholder="Buscar por nombre o email…"
                query={qAnest}
                onQueryChange={setQAnest}
                options={anestOpts}
                loading={Boolean(anestSearch.isFetching)}
                selected={anestesiologo}
                onSelect={setAnestesiologo}
                onClear={() => {
                  setAnestesiologo(null);
                  setQAnest("");
                }}
              />

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="sala">
                  Sala QX (quirófano) <span className="text-destructive">*</span>
                </Label>
                <select
                  id="sala"
                  value={salaQxId}
                  onChange={(e) => setSalaQxId(e.target.value)}
                  required
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Selecciona quirófano —</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {roomsQ.isFetching
                    ? "Cargando quirófanos…"
                    : rooms.length === 0
                      ? "No hay quirófanos activos en tu organización."
                      : "El servidor valida que la sala no tenga overlap en el horario propuesto (CONFLICT si está ocupada)."}
                </p>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="motivo">Motivo de ingreso (opcional)</Label>
                <Textarea
                  id="motivo"
                  value={motivoIngreso}
                  onChange={(e) => setMotivoIngreso(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Descripción clínica del motivo de hospitalización"
                />
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/ece/quirofano/programacion">Cancelar</Link>
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Programando…" : "Programar cirugía"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
