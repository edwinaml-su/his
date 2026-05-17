"use client";

/**
 * ECE — Nuevo Registro Anestésico Intraoperatorio.
 *
 * Formulario: datos base (ASA / tipo / vía) + campos opcionales.
 * Los signos vitales se registran desde la página de detalle.
 *
 * Rol habilitado: ESP.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
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
import { trpc } from "@/lib/trpc/react";

type TipoAnestesia = "general" | "regional" | "local" | "sedacion";
type ViaAerea = "intubacion" | "mascarilla" | "lma";

interface FormState {
  actoQuirurgicoId: string;
  asa: string;
  tipoAnestesia: TipoAnestesia;
  viaAerea: ViaAerea;
  complicaciones: string;
  fluidoterapiaMl: string;
  perdidasSanguineasMl: string;
}

const INITIAL_FORM: FormState = {
  actoQuirurgicoId: "",
  asa: "2",
  tipoAnestesia: "general",
  viaAerea: "intubacion",
  complicaciones: "",
  fluidoterapiaMl: "",
  perdidasSanguineasMl: "",
};

function toIntOrUndefined(v: string): number | undefined {
  if (v === "") return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

function validate(f: FormState): string | null {
  if (!f.actoQuirurgicoId.trim()) {
    return "El UUID del acto quirúrgico es requerido.";
  }
  if (!/^[0-9a-f-]{36}$/i.test(f.actoQuirurgicoId.trim())) {
    return "UUID del acto quirúrgico con formato inválido.";
  }
  const asa = parseInt(f.asa, 10);
  if (isNaN(asa) || asa < 1 || asa > 5) {
    return "ASA debe estar entre 1 y 5.";
  }
  const ft = toIntOrUndefined(f.fluidoterapiaMl);
  if (ft !== undefined && ft < 0) return "Fluidoterapia no puede ser negativa.";
  const ps = toIntOrUndefined(f.perdidasSanguineasMl);
  if (ps !== undefined && ps < 0) return "Pérdidas sanguíneas no pueden ser negativas.";
  return null;
}

export default function NuevoRegistroAnestesicoPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const createMutation = trpc.eceRegistroAnestesico.create.useMutation({
    onSuccess: (data) => {
      router.push(`/ece/registro-anestesico/${data.id}`);
    },
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    createMutation.mutate({
      actoQuirurgicoId: form.actoQuirurgicoId.trim(),
      asa: parseInt(form.asa, 10),
      tipoAnestesia: form.tipoAnestesia,
      viaAerea: form.viaAerea,
      complicaciones: form.complicaciones || undefined,
      fluidoterapiaMl: toIntOrUndefined(form.fluidoterapiaMl),
      perdidasSanguineasMl: toIntOrUndefined(form.perdidasSanguineasMl),
    });
  }

  const errorMsg = clientError ?? createMutation.error?.message ?? null;
  const isSubmitting = createMutation.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          Nuevo Registro Anestésico Intraoperatorio
        </h1>
        <p className="text-sm text-muted-foreground">
          REG_ANEST — quedará en Borrador hasta la firma por el anestesiólogo.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {/* Identificación del acto */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="acto-id">UUID del acto quirúrgico *</Label>
              <Input
                id="acto-id"
                required
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={form.actoQuirurgicoId}
                onChange={(e) => update("actoQuirurgicoId", e.target.value)}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>

        {/* Clasificación y técnica */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clasificación y técnica</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="asa">Clasificación ASA *</Label>
              <Select
                value={form.asa}
                onValueChange={(v) => update("asa", v as FormState["asa"])}
              >
                <SelectTrigger id="asa">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      ASA {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo-anest">Tipo de anestesia *</Label>
              <Select
                value={form.tipoAnestesia}
                onValueChange={(v) =>
                  update("tipoAnestesia", v as TipoAnestesia)
                }
              >
                <SelectTrigger id="tipo-anest">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="regional">Regional</SelectItem>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="sedacion">Sedación</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="via-aerea">Vía aérea *</Label>
              <Select
                value={form.viaAerea}
                onValueChange={(v) => update("viaAerea", v as ViaAerea)}
              >
                <SelectTrigger id="via-aerea">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="intubacion">Intubación OT</SelectItem>
                  <SelectItem value="mascarilla">Mascarilla facial</SelectItem>
                  <SelectItem value="lma">LMA / mascarilla laríngea</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Balance hídrico */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Balance hídrico</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fluidoterapia">Fluidoterapia (ml)</Label>
              <Input
                id="fluidoterapia"
                type="number"
                min={0}
                value={form.fluidoterapiaMl}
                onChange={(e) => update("fluidoterapiaMl", e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perdidas">Pérdidas sanguíneas (ml)</Label>
              <Input
                id="perdidas"
                type="number"
                min={0}
                value={form.perdidasSanguineasMl}
                onChange={(e) => update("perdidasSanguineasMl", e.target.value)}
                placeholder="0"
              />
            </div>
          </CardContent>
        </Card>

        {/* Complicaciones */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Complicaciones / Incidencias</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              id="complicaciones"
              rows={3}
              value={form.complicaciones}
              onChange={(e) => update("complicaciones", e.target.value)}
              placeholder="Registrar cualquier evento adverso o incidencia intraoperatoria…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </CardContent>
        </Card>

        {errorMsg && (
          <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
            {errorMsg}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Guardando…" : "Guardar borrador"}
          </Button>
        </div>
      </form>
    </div>
  );
}
