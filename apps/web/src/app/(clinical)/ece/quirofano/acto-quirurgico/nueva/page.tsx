"use client";

/**
 * ECE — Nueva programación de acto quirúrgico.
 *
 * BRIDGE de consentimiento:
 *   Antes de permitir crear el acto quirúrgico, verifica que exista al menos un
 *   consentimiento CONS_QX con estado 'firmado' para el episodio dado.
 *
 *   Si no existe → muestra bloqueo con enlace para crear el consentimiento.
 *   Si existe    → muestra el formulario de programación.
 *
 * La verificación es UI-only; el backend también debe validar en el mutation de
 * creación del acto quirúrgico (defensa en profundidad).
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { trpc } from "@/lib/trpc/react";

// ─── Hook: verifica consentimiento QX firmado ─────────────────────────────────

function useConsentimientoQxFirmado(episodioId: string) {
  const query = trpc.eceConsentimiento.list.useQuery(
    { episodioId: episodioId.trim() || undefined, limit: 10 },
    { enabled: !!episodioId.trim() },
  );

  const consentimientoFirmado = React.useMemo(() => {
    if (!query.data) return null;
    return query.data.items.find(
      (r) => r.tipo === "quirurgico" && r.estado_codigo === "firmado",
    ) ?? null;
  }, [query.data]);

  return {
    loading: query.isLoading,
    firmado: consentimientoFirmado !== null,
    consentimientoId: consentimientoFirmado?.id ?? null,
  };
}

// ─── Banner de bloqueo ────────────────────────────────────────────────────────

function ConsentimientoBloqueado({ episodioId }: { episodioId: string }) {
  const href =
    episodioId.trim()
      ? `/ece/quirofano/consentimiento-qx/nuevo?episodioId=${encodeURIComponent(episodioId)}`
      : "/ece/quirofano/consentimiento-qx/nuevo";

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Lock className="h-5 w-5" aria-hidden />
          Consentimiento quirúrgico requerido
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            No se puede programar un acto quirúrgico sin un{" "}
            <strong>consentimiento quirúrgico firmado (CONS_QX)</strong> para este episodio.
            Obtenga primero la firma del paciente y del médico cirujano.
          </span>
        </div>
        <Button asChild>
          <Link href={href}>Crear consentimiento quirúrgico</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Formulario de programación (stub accesible cuando hay CONS_QX) ───────────

interface FormState {
  fechaProgramada: string;
  quirofanoId: string;
  cirujanoId: string;
  observaciones: string;
}

function FormActoQuirurgico({
  episodioId,
  consentimientoQxId,
}: {
  episodioId: string;
  consentimientoQxId: string;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>({
    fechaProgramada: "",
    quirofanoId: "",
    cirujanoId: "",
    observaciones: "",
  });
  const [error, setError] = React.useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fechaProgramada) { setError("La fecha programada es requerida."); return; }
    if (!form.cirujanoId.trim()) { setError("El cirujano es requerido."); return; }
    // El mutation real de creación del acto se implementará en el router de quirófano.
    // Por ahora navegamos al listado con el parámetro para confirmar visualmente.
    router.push(`/ece/quirofano/acto-quirurgico?episodioId=${encodeURIComponent(episodioId)}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden />
          Programar acto quirúrgico
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-2 rounded-md border border-green-400/50 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          Consentimiento quirúrgico firmado verificado (ID: {consentimientoQxId.slice(0, 8)}…)
        </div>

        <Form onSubmit={onSubmit}>
          <FormField>
            <Label htmlFor="fechaProgramada">Fecha y hora programada</Label>
            <Input
              id="fechaProgramada"
              type="datetime-local"
              required
              value={form.fechaProgramada}
              onChange={(e) => setForm((p) => ({ ...p, fechaProgramada: e.target.value }))}
            />
          </FormField>

          <FormField>
            <Label htmlFor="quirofanoId">Quirófano (UUID o código)</Label>
            <Input
              id="quirofanoId"
              placeholder="QX-01 o UUID..."
              value={form.quirofanoId}
              onChange={(e) => setForm((p) => ({ ...p, quirofanoId: e.target.value }))}
            />
          </FormField>

          <FormField>
            <Label htmlFor="cirujanoId">Médico cirujano (UUID)</Label>
            <Input
              id="cirujanoId"
              required
              placeholder="xxxxxxxx-xxxx-..."
              value={form.cirujanoId}
              onChange={(e) => setForm((p) => ({ ...p, cirujanoId: e.target.value }))}
            />
          </FormField>

          <FormField>
            <Label htmlFor="observaciones">Observaciones (opcional)</Label>
            <textarea
              id="observaciones"
              value={form.observaciones}
              onChange={(e) => setForm((p) => ({ ...p, observaciones: e.target.value }))}
              className="min-h-[80px] w-full rounded-md border bg-background p-3 text-sm"
              maxLength={1000}
            />
          </FormField>

          {error && <FormError>{error}</FormError>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancelar
            </Button>
            <Button type="submit" className="bg-[#1a3c6e] hover:bg-[#15305a] text-white">
              Programar acto quirúrgico
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function NuevoActoQuirurgicoPage() {
  const searchParams = useSearchParams();
  const episodioIdParam = searchParams.get("episodioId") ?? "";

  const [episodioId, setEpisodioId] = React.useState(episodioIdParam);
  const [episodioConfirmado, setEpisodioConfirmado] = React.useState(!!episodioIdParam.trim());

  const { loading, firmado, consentimientoId } = useConsentimientoQxFirmado(
    episodioConfirmado ? episodioId : "",
  );

  function onConfirmarEpisodio(e: React.FormEvent) {
    e.preventDefault();
    if (episodioId.trim()) setEpisodioConfirmado(true);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nuevo acto quirúrgico</h1>
        <p className="text-sm text-muted-foreground">
          Requiere consentimiento quirúrgico firmado (CONS_QX) para el episodio.
        </p>
      </div>

      {/* Selector de episodio si no viene en query param */}
      {!episodioConfirmado && (
        <Card>
          <CardHeader><CardTitle>Identificar episodio</CardTitle></CardHeader>
          <CardContent>
            <Form onSubmit={onConfirmarEpisodio}>
              <FormField>
                <Label htmlFor="episodioId">Episodio (UUID)</Label>
                <Input
                  id="episodioId"
                  required
                  placeholder="xxxxxxxx-xxxx-..."
                  value={episodioId}
                  onChange={(e) => setEpisodioId(e.target.value)}
                />
              </FormField>
              <div className="flex justify-end">
                <Button type="submit">Verificar consentimiento</Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}

      {/* Verificación en progreso */}
      {episodioConfirmado && loading && (
        <p className="text-sm text-muted-foreground">Verificando consentimiento quirúrgico…</p>
      )}

      {/* Bridge: bloqueo si no hay CONS_QX firmado */}
      {episodioConfirmado && !loading && !firmado && (
        <ConsentimientoBloqueado episodioId={episodioId} />
      )}

      {/* Formulario habilitado solo cuando existe CONS_QX firmado */}
      {episodioConfirmado && !loading && firmado && consentimientoId && (
        <FormActoQuirurgico
          episodioId={episodioId}
          consentimientoQxId={consentimientoId}
        />
      )}
    </div>
  );
}
