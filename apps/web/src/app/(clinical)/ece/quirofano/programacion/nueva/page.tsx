"use client";

/**
 * Nueva Programación Quirúrgica — flujo de creación de orden quirúrgica.
 *
 * Llama a `eceBridgeCirugia.programarCirugia` (transacción atómica):
 *   orden_ingreso → episodio_atencion → episodio_hospitalario → preop_checklist
 *   → reserva_sala_qx → outbox event ece.cirugia.programada.
 *
 * Acceso: PHYSICIAN | ADM (validado server-side via requireRole).
 * Hard-stop: sala ocupada en horario propuesto → CONFLICT.
 *
 * @QA E2E: completar form → submit → redirigir a /ece/quirofano/programacion
 *   con la nueva cirugía visible; doble-reserva → mensaje CONFLICT.
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

interface FormState {
  pacienteId: string;
  procedimientoCie10: string;
  fechaProgramada: string;
  cirujanoId: string;
  anestesiologoId: string;
  salaQxId: string;
  duracionEstimadaMin: number;
  motivoIngreso: string;
}

const INITIAL: FormState = {
  pacienteId: "",
  procedimientoCie10: "",
  fechaProgramada: "",
  cirujanoId: "",
  anestesiologoId: "",
  salaQxId: "",
  duracionEstimadaMin: 60,
  motivoIngreso: "",
};

function toIsoOffset(local: string): string {
  // Convierte input datetime-local (sin tz) a ISO con offset SV (-06:00).
  if (!local) return "";
  return `${local}:00-06:00`;
}

export default function NuevaProgramacionPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mutation = trpc.eceBridgeCirugia.programarCirugia.useMutation({
    onSuccess: () => {
      router.push("/ece/quirofano/programacion");
    },
    onError: (err: { message: string }) => {
      setError(err.message ?? "Error al programar cirugía");
      setSubmitting(false);
    },
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      pacienteId: form.pacienteId.trim(),
      procedimientoCie10: form.procedimientoCie10.trim(),
      fechaProgramada: toIsoOffset(form.fechaProgramada),
      cirujanoId: form.cirujanoId.trim(),
      anestesiologoId: form.anestesiologoId.trim(),
      salaQxId: form.salaQxId.trim(),
      duracionEstimadaMin: form.duracionEstimadaMin,
      ...(form.motivoIngreso.trim()
        ? { motivoIngreso: form.motivoIngreso.trim() }
        : {}),
    };

    mutation.mutate(payload);
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
              <div className="space-y-1.5">
                <Label htmlFor="pacienteId">Paciente (UUID) *</Label>
                <Input
                  id="pacienteId"
                  value={form.pacienteId}
                  onChange={(e) => update("pacienteId", e.target.value)}
                  required
                  placeholder="00000000-0000-0000-0000-000000000000"
                  aria-describedby="hint-paciente"
                />
                <p id="hint-paciente" className="text-xs text-muted-foreground">
                  UUID del registro Patient.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cie10">Procedimiento CIE-10 *</Label>
                <Input
                  id="cie10"
                  value={form.procedimientoCie10}
                  onChange={(e) =>
                    update("procedimientoCie10", e.target.value.toUpperCase())
                  }
                  required
                  maxLength={20}
                  placeholder="K35.80"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fecha">Fecha y hora programada *</Label>
                <Input
                  id="fecha"
                  type="datetime-local"
                  value={form.fechaProgramada}
                  onChange={(e) => update("fechaProgramada", e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Zona horaria: America/El_Salvador (UTC-06:00).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="duracion">Duración estimada (min) *</Label>
                <Input
                  id="duracion"
                  type="number"
                  min={1}
                  max={1440}
                  value={form.duracionEstimadaMin}
                  onChange={(e) =>
                    update(
                      "duracionEstimadaMin",
                      Number(e.target.value) || 60,
                    )
                  }
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cirujano">Cirujano (UUID) *</Label>
                <Input
                  id="cirujano"
                  value={form.cirujanoId}
                  onChange={(e) => update("cirujanoId", e.target.value)}
                  required
                  placeholder="UUID del usuario MEDICO"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="anestesiologo">Anestesiólogo (UUID) *</Label>
                <Input
                  id="anestesiologo"
                  value={form.anestesiologoId}
                  onChange={(e) => update("anestesiologoId", e.target.value)}
                  required
                  placeholder="UUID del usuario MEDICO_ANESTESIA"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="sala">Sala QX (UUID) *</Label>
                <Input
                  id="sala"
                  value={form.salaQxId}
                  onChange={(e) => update("salaQxId", e.target.value)}
                  required
                  placeholder="UUID de la sala quirúrgica"
                />
                <p className="text-xs text-muted-foreground">
                  El servidor valida que la sala no tenga overlap en el horario
                  propuesto (CONFLICT si está ocupada).
                </p>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="motivo">Motivo de ingreso (opcional)</Label>
                <Textarea
                  id="motivo"
                  value={form.motivoIngreso}
                  onChange={(e) => update("motivoIngreso", e.target.value)}
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
              <Button type="submit" disabled={submitting || mutation.isPending}>
                {submitting || mutation.isPending
                  ? "Programando…"
                  : "Programar cirugía"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
