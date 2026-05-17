"use client";

/**
 * ECE — Nueva Lista de Verificación Preoperatoria.
 * NTEC Art. 28, Acuerdo n.° 1616 MINSAL 2024.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {children}
    </div>
  );
}

function CheckRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}

interface FormState {
  episodioHospitalarioId: string;
  ayunoHoras: string;
  marcapasos: boolean;
  alergias: string;
  anticoagulantes: boolean;
  retiroProtesis: boolean;
  identificacionPacienteVerificada: boolean;
  sitioMarcado: boolean;
  consentimientoFirmado: boolean;
  riesgoAnestesicoAsa: string;
}

const INITIAL: FormState = {
  episodioHospitalarioId: "",
  ayunoHoras: "",
  marcapasos: false,
  alergias: "",
  anticoagulantes: false,
  retiroProtesis: false,
  identificacionPacienteVerificada: false,
  sitioMarcado: false,
  consentimientoFirmado: false,
  riesgoAnestesicoAsa: "",
};

export default function NuevaPreopPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const episodioParam = searchParams.get("episodioHospitalarioId") ?? "";

  const [form, setForm] = React.useState<FormState>({
    ...INITIAL,
    episodioHospitalarioId: episodioParam,
  });
  const [error, setError] = React.useState<string | null>(null);

  const createMutation = trpc.eceCirugiaPreop.create.useMutation({
    onSuccess(data: { id: string }) {
      router.push(`/ece/quirofano/preop/${data.id}`);
    },
    onError(err: { message: string }) {
      setError(err.message);
    },
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const ayunoHoras = form.ayunoHoras ? parseInt(form.ayunoHoras, 10) : undefined;
    const riesgoAnestesicoAsa = form.riesgoAnestesicoAsa
      ? parseInt(form.riesgoAnestesicoAsa, 10)
      : undefined;

    createMutation.mutate({
      episodioHospitalarioId: form.episodioHospitalarioId.trim(),
      ayunoHoras,
      marcapasos: form.marcapasos,
      alergias: form.alergias || undefined,
      anticoagulantes: form.anticoagulantes,
      retiroProtesis: form.retiroProtesis,
      identificacionPacienteVerificada: form.identificacionPacienteVerificada,
      sitioMarcado: form.sitioMarcado,
      consentimientoFirmado: form.consentimientoFirmado,
      riesgoAnestesicoAsa,
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-semibold">Nuevo checklist preoperatorio</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-sm">Datos del checklist (NTEC Art. 28)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Episodio hospitalario */}
            <Field id="episodioHospitalarioId" label="UUID del episodio hospitalario *">
              <Input
                id="episodioHospitalarioId"
                value={form.episodioHospitalarioId}
                onChange={(e) => set("episodioHospitalarioId", e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                required
                className="font-mono text-xs"
              />
            </Field>

            {/* Campos numéricos */}
            <div className="grid grid-cols-2 gap-4">
              <Field id="ayunoHoras" label="Horas de ayuno (0-24)">
                <Input
                  id="ayunoHoras"
                  type="number"
                  min={0}
                  max={24}
                  value={form.ayunoHoras}
                  onChange={(e) => set("ayunoHoras", e.target.value)}
                  placeholder="8"
                />
              </Field>
              <Field id="riesgoAnestesicoAsa" label="Riesgo anestésico ASA (1-5)">
                <Input
                  id="riesgoAnestesicoAsa"
                  type="number"
                  min={1}
                  max={5}
                  value={form.riesgoAnestesicoAsa}
                  onChange={(e) => set("riesgoAnestesicoAsa", e.target.value)}
                  placeholder="2"
                />
              </Field>
            </div>

            {/* Alergias */}
            <Field id="alergias" label="Alergias conocidas">
              <Input
                id="alergias"
                value={form.alergias}
                onChange={(e) => set("alergias", e.target.value)}
                placeholder="Penicilina, látex…"
              />
            </Field>

            {/* Checkboxes */}
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Ítems de verificación
              </p>
              <CheckRow
                id="marcapasos"
                label="Marcapasos / dispositivo implantado"
                checked={form.marcapasos}
                onChange={(v) => set("marcapasos", v)}
              />
              <CheckRow
                id="anticoagulantes"
                label="Anticoagulantes / antiagregantes"
                checked={form.anticoagulantes}
                onChange={(v) => set("anticoagulantes", v)}
              />
              <CheckRow
                id="retiroProtesis"
                label="Retiro de prótesis, joyas y accesorios"
                checked={form.retiroProtesis}
                onChange={(v) => set("retiroProtesis", v)}
              />
              <CheckRow
                id="identificacionPacienteVerificada"
                label="Identificación del paciente verificada (pulsera + verbal)"
                checked={form.identificacionPacienteVerificada}
                onChange={(v) => set("identificacionPacienteVerificada", v)}
              />
              <CheckRow
                id="sitioMarcado"
                label="Sitio quirúrgico marcado"
                checked={form.sitioMarcado}
                onChange={(v) => set("sitioMarcado", v)}
              />
              <CheckRow
                id="consentimientoFirmado"
                label="Consentimiento informado firmado en expediente"
                checked={form.consentimientoFirmado}
                onChange={(v) => set("consentimientoFirmado", v)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-3">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Guardando…" : "Guardar checklist"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/ece/quirofano/preop")}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
