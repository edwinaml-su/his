"use client";

/**
 * ECE — Nuevo Certificado de Defunción.
 * Form MINSAL: causa directa (CIE-10 typeahead) + causas intermedias + causa básica
 * + manera + autopsia + firma MC (PIN).
 *
 * Integración alta: si se accede con ?episodioId=X, el campo episodio se pre-rellena.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ──────────────────────────────────────────────────────────────────────────────
// CIE-10 Typeahead (simple — búsqueda local sobre lista reducida)
// En producción debería conectar al catálogo de CIE-10 via tRPC.
// ──────────────────────────────────────────────────────────────────────────────

const CIE10_COMUNES: { codigo: string; descripcion: string }[] = [
  { codigo: "J18.9", descripcion: "Neumonía, no especificada" },
  { codigo: "I50.9", descripcion: "Insuficiencia cardíaca, no especificada" },
  { codigo: "I21.9", descripcion: "Infarto agudo de miocardio, no especificado" },
  { codigo: "I64", descripcion: "Accidente vascular encefálico agudo, no especificado" },
  { codigo: "K92.2", descripcion: "Hemorragia gastrointestinal, no especificada" },
  { codigo: "A41.9", descripcion: "Septicemia, no especificada" },
  { codigo: "C80.1", descripcion: "Neoplasia maligna, sitio no especificado" },
  { codigo: "E11.9", descripcion: "Diabetes mellitus tipo 2, sin complicaciones" },
  { codigo: "N18.5", descripcion: "Enfermedad renal crónica, estadio 5" },
  { codigo: "J44.1", descripcion: "EPOC con exacerbación aguda" },
];

interface Cie10SelectorProps {
  id: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function Cie10Selector({ id, value, onChange, placeholder, disabled }: Cie10SelectorProps) {
  const [query, setQuery] = React.useState(value);
  const [showSuggestions, setShowSuggestions] = React.useState(false);

  const suggestions = query.length >= 1
    ? CIE10_COMUNES.filter(
        (c) =>
          c.codigo.toLowerCase().includes(query.toLowerCase()) ||
          c.descripcion.toLowerCase().includes(query.toLowerCase()),
      ).slice(0, 6)
    : [];

  return (
    <div className="relative">
      <Input
        id={id}
        value={query}
        disabled={disabled}
        placeholder={placeholder ?? "Ej. J18.9 o Neumonía"}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value.toUpperCase().trim());
          setShowSuggestions(true);
        }}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
      />
      {showSuggestions && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          {suggestions.map((s) => (
            <li key={s.codigo}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={() => {
                  onChange(s.codigo);
                  setQuery(`${s.codigo} — ${s.descripcion}`);
                  setShowSuggestions(false);
                }}
              >
                <span className="font-mono text-xs text-muted-foreground">{s.codigo}</span>
                <span className="truncate">{s.descripcion}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Form principal
// ──────────────────────────────────────────────────────────────────────────────

export default function NuevaCertDefPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const episodioPreset = searchParams.get("episodioId") ?? "";
  const epicrisisPreset = searchParams.get("epicrisisId") ?? "";

  const [episodioId, setEpisodioId] = React.useState(episodioPreset);
  const [epicrisisId, setEpicrisisId] = React.useState(epicrisisPreset);
  const [fechaHoraDefuncion, setFechaHoraDefuncion] = React.useState("");
  const [lugarDefuncion, setLugarDefuncion] = React.useState<"intrahospitalaria" | "extrahospitalaria">("intrahospitalaria");
  const [causaPrincipal, setCausaPrincipal] = React.useState("");
  const [causasIntermedias, setCausasIntermedias] = React.useState<string[]>([""]);
  const [causaBasica, setCausaBasica] = React.useState("");
  const [manera, setManera] = React.useState<"natural" | "violenta" | "accidental" | "suicidio" | "homicidio" | "indeterminada">("natural");
  const [autopsia, setAutopsia] = React.useState(false);
  const [observaciones, setObservaciones] = React.useState("");

  // PIN para firma MC (opcional en creación — se puede firmar desde el detalle)
  const [pin, setPin] = React.useState("");
  const [firmarAlCrear, setFirmarAlCrear] = React.useState(false);

  const createMutation = trpc.eceCertDef.create.useMutation();
  const firmarMutation = trpc.eceCertDef.firmar.useMutation();

  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function addCausaIntermedia() {
    if (causasIntermedias.length >= 3) return;
    setCausasIntermedias((prev) => [...prev, ""]);
  }

  function removeCausaIntermedia(idx: number) {
    setCausasIntermedias((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateCausaIntermedia(idx: number, val: string) {
    setCausasIntermedias((prev) => prev.map((c, i) => (i === idx ? val : c)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!episodioId.trim()) { setError("El ID del episodio es requerido."); return; }
    if (!epicrisisId.trim()) { setError("El ID de la epicrisis es requerido."); return; }
    if (!fechaHoraDefuncion) { setError("La fecha y hora de defunción son requeridas."); return; }
    if (!causaPrincipal.trim()) { setError("La causa principal (CIE-10) es requerida."); return; }
    if (!causaBasica.trim()) { setError("La causa básica (CIE-10) es requerida."); return; }
    if (firmarAlCrear && !pin.trim()) { setError("El PIN es requerido para firmar al crear."); return; }

    setSubmitting(true);
    try {
      const causasFiltered = causasIntermedias.filter((c) => c.trim().length > 0);
      const result = await createMutation.mutateAsync({
        episodioId: episodioId.trim(),
        epicrisisId: epicrisisId.trim(),
        fechaHoraDefuncion: new Date(fechaHoraDefuncion),
        lugarDefuncion,
        causaPrincipalCie10: causaPrincipal.split(" ")[0]!,
        causasIntermediasCie10: causasFiltered.map((c) => c.split(" ")[0]!),
        causaBasicaCie10: causaBasica.split(" ")[0]!,
        manera,
        autopsiaRealizada: autopsia,
        observaciones: observaciones.trim() || undefined,
      });

      if (firmarAlCrear && pin.trim()) {
        await firmarMutation.mutateAsync({ id: result.id, pin: pin.trim() });
      }

      router.push(`/ece/defuncion/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido al crear el certificado.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Nuevo Certificado de Defunción</h1>

      {/* Banner inmutabilidad */}
      <div
        role="note"
        className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
      >
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>DOCUMENTO INMUTABLE POST-FIRMA.</strong> Verifique todos los datos
          antes de firmar. La información no podrá modificarse una vez firmada.
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Episodio */}
        <Card>
          <CardHeader><CardTitle>Datos del episodio</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="episodio-id">
                ID Episodio hospitalario <span className="text-destructive">*</span>
              </Label>
              <Input
                id="episodio-id"
                value={episodioId}
                onChange={(e) => setEpisodioId(e.target.value)}
                placeholder="UUID del episodio"
                disabled={!!episodioPreset}
                required
              />
              {episodioPreset && (
                <p className="text-xs text-muted-foreground">Pre-rellenado desde alta hospitalaria.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="epicrisis-id">
                ID Epicrisis de egreso <span className="text-destructive">*</span>
              </Label>
              <Input
                id="epicrisis-id"
                value={epicrisisId}
                onChange={(e) => setEpicrisisId(e.target.value)}
                placeholder="UUID de la epicrisis (tipo_egreso = fallecido)"
                disabled={!!epicrisisPreset}
                required
              />
              {epicrisisPreset && (
                <p className="text-xs text-muted-foreground">Pre-rellenado desde epicrisis de egreso.</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fecha-hora">
                  Fecha y hora de defunción <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="fecha-hora"
                  type="datetime-local"
                  value={fechaHoraDefuncion}
                  onChange={(e) => setFechaHoraDefuncion(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lugar">
                  Lugar de defunción <span className="text-destructive">*</span>
                </Label>
                <select
                  id="lugar"
                  value={lugarDefuncion}
                  onChange={(e) => setLugarDefuncion(e.target.value as typeof lugarDefuncion)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="intrahospitalaria">Intrahospitalaria</option>
                  <option value="extrahospitalaria">Extrahospitalaria</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Causas CIE-10 */}
        <Card>
          <CardHeader>
            <CardTitle>Causas de muerte (formato MINSAL)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="causa-principal">
                Causa directa / línea A <span className="text-destructive">*</span>
              </Label>
              <Cie10Selector
                id="causa-principal"
                value={causaPrincipal}
                onChange={setCausaPrincipal}
                placeholder="Ej. J18.9 — Neumonía"
              />
              <p className="text-xs text-muted-foreground">
                Enfermedad o lesión que causó directamente la muerte.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Causas intermedias / líneas B-C (máx. 3)</Label>
                {causasIntermedias.length < 3 && (
                  <Button type="button" variant="ghost" size="sm" onClick={addCausaIntermedia}>
                    <Plus className="mr-1 h-3 w-3" aria-hidden />
                    Agregar
                  </Button>
                )}
              </div>
              {causasIntermedias.map((c, idx) => (
                <div key={idx} className="flex gap-2">
                  <Cie10Selector
                    id={`causa-inter-${idx}`}
                    value={c}
                    onChange={(v) => updateCausaIntermedia(idx, v)}
                    placeholder={`Línea ${["B", "C", "D"][idx]} (opcional)`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCausaIntermedia(idx)}
                    aria-label="Eliminar causa intermedia"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="causa-basica">
                Causa básica / subyacente <span className="text-destructive">*</span>
              </Label>
              <Cie10Selector
                id="causa-basica"
                value={causaBasica}
                onChange={setCausaBasica}
                placeholder="Causa raíz — ej. E11.9"
              />
              <p className="text-xs text-muted-foreground">
                Enfermedad o lesión que inició la cadena de eventos.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Manera y autopsia */}
        <Card>
          <CardHeader><CardTitle>Manera de muerte y autopsia</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="manera">
                Manera de muerte <span className="text-destructive">*</span>
              </Label>
              <select
                id="manera"
                value={manera}
                onChange={(e) => setManera(e.target.value as typeof manera)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="natural">Natural</option>
                <option value="violenta">Violenta</option>
                <option value="accidental">Accidental</option>
                <option value="suicidio">Suicidio</option>
                <option value="homicidio">Homicidio</option>
                <option value="indeterminada">Indeterminada</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="autopsia"
                type="checkbox"
                checked={autopsia}
                onChange={(e) => setAutopsia(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="autopsia">Autopsia realizada</Label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="observaciones">Observaciones (opcional)</Label>
              <textarea
                id="observaciones"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={3}
                maxLength={2000}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                placeholder="Observaciones adicionales para el certificado."
              />
            </div>
          </CardContent>
        </Card>

        {/* Firma MC (opcional al crear) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Firma MC
              <Badge variant="outline">Opcional al crear</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                id="firmar-al-crear"
                type="checkbox"
                checked={firmarAlCrear}
                onChange={(e) => setFirmarAlCrear(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="firmar-al-crear">
                Firmar el certificado inmediatamente al crear
              </Label>
            </div>

            {firmarAlCrear && (
              <div className="space-y-1.5">
                <Label htmlFor="pin">
                  PIN de firma electrónica <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="6–8 dígitos"
                  required={firmarAlCrear}
                />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Al firmar, el certificado es INMUTABLE y no podrá modificarse.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/ece/defuncion")}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : firmarAlCrear ? "Crear y firmar" : "Crear borrador"}
          </Button>
        </div>
      </form>
    </div>
  );
}
