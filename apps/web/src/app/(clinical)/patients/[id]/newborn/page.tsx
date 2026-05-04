"use client";

/**
 * US-4.6 — Vínculo recién-nacido ↔ madre (UI).
 *
 * 2 modos según el paciente actual:
 *  A) Paciente NEONATO (< 28 días) sin madre vinculada → form para buscar madre
 *     existente y vincular.
 *  B) Paciente FEMENINO ADULTO → form para crear RN nuevo con datos perinatales
 *     mínimos.
 *
 * Si el paciente no encaja en ninguno de los dos perfiles, mostramos guía y
 * acceso al detalle. Si ya tiene madre vinculada, mostramos panel con info y
 * botón unlink.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField, FormError, FormHint } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

const NEWBORN_MAX_AGE_DAYS = 28;

function ageInDays(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = typeof birthDate === "string" ? new Date(birthDate) : birthDate;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export default function NewbornPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const patientQ = trpc.patient.get.useQuery({ id: params.id });
  const utils = trpc.useUtils();

  if (patientQ.isLoading)
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (patientQ.error)
    return <p className="text-sm text-destructive">{patientQ.error.message}</p>;

  const patient = patientQ.data!;
  const age = ageInDays(patient.birthDate);
  const isNeonate = age !== null && age <= NEWBORN_MAX_AGE_DAYS && age >= 0;
  const isFemaleAdult =
    patient.biologicalSex?.code === "F" && (age ?? 0) > 365 * 12;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Vínculo madre-RN</h1>
        <p className="text-xs font-mono text-muted-foreground">
          Paciente {patient.lastName}, {patient.firstName} · MRN {patient.mrn}
        </p>
      </div>

      {patient.motherPatientId ? (
        <LinkedMotherPanel
          newbornId={patient.id}
          motherId={patient.motherPatientId}
          onUnlinked={() => utils.patient.get.invalidate({ id: params.id })}
        />
      ) : isNeonate ? (
        <LinkExistingMotherForm
          newbornId={patient.id}
          onLinked={() => utils.patient.get.invalidate({ id: params.id })}
        />
      ) : isFemaleAdult ? (
        <CreateNewbornForm
          motherId={patient.id}
          onCreated={(newbornId) => router.push(`/patients/${newbornId}`)}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Paciente fuera de criterio neonatal</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Este paciente no es un neonato (&lt;{NEWBORN_MAX_AGE_DAYS} días)
              ni una mujer adulta candidata para registrar RN. Edad estimada:{" "}
              {age === null ? "desconocida" : `${age} días`}.
            </p>
            <p>
              Si necesitas vincular un RN ya registrado, navega al expediente
              del RN. TODO Sprint 4: vínculo retroactivo madre↔hijo no-neonatal.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Subcomponentes
// ============================================================================

function LinkedMotherPanel({
  newbornId,
  motherId,
  onUnlinked,
}: {
  newbornId: string;
  motherId: string;
  onUnlinked: () => void;
}) {
  const motherQ = trpc.patient.get.useQuery({ id: motherId });
  const unlink = trpc.newborn.unlinkMother.useMutation({
    onSuccess: onUnlinked,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Madre vinculada</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {motherQ.isLoading && <p className="text-sm">Cargando madre…</p>}
        {motherQ.data && (
          <div className="text-sm space-y-1">
            <p className="font-medium">
              {motherQ.data.lastName}
              {motherQ.data.secondLastName ? ` ${motherQ.data.secondLastName}` : ""}
              , {motherQ.data.firstName}
            </p>
            <p className="text-xs font-mono text-muted-foreground">
              MRN {motherQ.data.mrn}
            </p>
            <Badge variant="secondary">Vínculo activo</Badge>
          </div>
        )}
        <FormError>{unlink.error?.message}</FormError>
        <Button
          variant="destructive"
          disabled={unlink.isPending}
          onClick={() => unlink.mutate({ newbornId })}
        >
          {unlink.isPending ? "Removiendo…" : "Romper vínculo"}
        </Button>
      </CardContent>
    </Card>
  );
}

function LinkExistingMotherForm({
  newbornId,
  onLinked,
}: {
  newbornId: string;
  onLinked: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const search = trpc.patient.search.useQuery(
    { query, limit: 10 },
    { enabled: query.trim().length >= 2 },
  );
  const link = trpc.newborn.linkMother.useMutation({ onSuccess: onLinked });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Buscar y vincular madre existente</CardTitle>
      </CardHeader>
      <CardContent>
        <Form onSubmit={(e) => e.preventDefault()}>
          <FormField>
            <Label htmlFor="search">Buscar por MRN, nombre o identificador</Label>
            <Input
              id="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Mín. 2 caracteres…"
            />
            <FormHint>
              Solo se mostrarán pacientes con sexo biológico femenino aptos
              para vincularse como madre.
            </FormHint>
          </FormField>
          <FormError>{link.error?.message}</FormError>
        </Form>

        <div className="mt-4 space-y-2">
          {search.data?.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between border rounded p-2"
            >
              <div className="text-sm">
                <p className="font-medium">
                  {p.lastName}
                  {p.secondLastName ? ` ${p.secondLastName}` : ""}, {p.firstName}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  MRN {p.mrn}
                </p>
              </div>
              <Button
                size="sm"
                disabled={link.isPending}
                onClick={() =>
                  link.mutate({ newbornId, motherId: p.id })
                }
              >
                Vincular
              </Button>
            </div>
          ))}
          {search.data?.length === 0 && query.length >= 2 && (
            <p className="text-xs text-muted-foreground">Sin resultados.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateNewbornForm({
  motherId,
  onCreated,
}: {
  motherId: string;
  onCreated: (newbornId: string) => void;
}) {
  const sexes = trpc.catalog.list.useQuery({
    catalog: "biologicalSex",
    activeOnly: true,
  });
  const create = trpc.newborn.createNewborn.useMutation({
    onSuccess: (r) => onCreated(r.newbornId),
  });

  const [form, setForm] = React.useState({
    firstName: "",
    lastName: "",
    secondLastName: "",
    birthDate: "",
    biologicalSexId: "",
    weightGrams: "",
    lengthCm: "",
    apgar1: "",
    apgar5: "",
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      motherId,
      firstName: form.firstName,
      lastName: form.lastName,
      secondLastName: form.secondLastName || null,
      birthDate: new Date(form.birthDate),
      biologicalSexId: form.biologicalSexId,
      weightGrams: form.weightGrams ? Number(form.weightGrams) : null,
      lengthCm: form.lengthCm ? Number(form.lengthCm) : null,
      apgar1: form.apgar1 ? Number(form.apgar1) : null,
      apgar5: form.apgar5 ? Number(form.apgar5) : null,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registrar nuevo recién-nacido</CardTitle>
      </CardHeader>
      <CardContent>
        <Form onSubmit={onSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label>Nombre</Label>
              <Input
                required
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
              />
            </FormField>
            <FormField>
              <Label>Apellido</Label>
              <Input
                required
                value={form.lastName}
                onChange={(e) =>
                  setForm({ ...form, lastName: e.target.value })
                }
              />
            </FormField>
            <FormField>
              <Label>Segundo apellido</Label>
              <Input
                value={form.secondLastName}
                onChange={(e) =>
                  setForm({ ...form, secondLastName: e.target.value })
                }
              />
            </FormField>
            <FormField>
              <Label>Fecha de nacimiento</Label>
              <Input
                type="date"
                required
                value={form.birthDate}
                onChange={(e) =>
                  setForm({ ...form, birthDate: e.target.value })
                }
              />
            </FormField>
            <FormField>
              <Label>Sexo biológico</Label>
              <Select
                value={form.biologicalSexId}
                onValueChange={(v) => setForm({ ...form, biologicalSexId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {sexes.data?.map((s: { id: string; name: string }) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label>Peso (g)</Label>
              <Input
                type="number"
                min={200}
                max={8000}
                value={form.weightGrams}
                onChange={(e) =>
                  setForm({ ...form, weightGrams: e.target.value })
                }
              />
            </FormField>
            <FormField>
              <Label>Talla (cm)</Label>
              <Input
                type="number"
                step="0.1"
                min={20}
                max={70}
                value={form.lengthCm}
                onChange={(e) =>
                  setForm({ ...form, lengthCm: e.target.value })
                }
              />
            </FormField>
            <FormField>
              <Label>APGAR 1 min</Label>
              <Input
                type="number"
                min={0}
                max={10}
                value={form.apgar1}
                onChange={(e) => setForm({ ...form, apgar1: e.target.value })}
              />
            </FormField>
            <FormField>
              <Label>APGAR 5 min</Label>
              <Input
                type="number"
                min={0}
                max={10}
                value={form.apgar5}
                onChange={(e) => setForm({ ...form, apgar5: e.target.value })}
              />
            </FormField>
          </div>
          <FormError>{create.error?.message}</FormError>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creando…" : "Crear y vincular RN"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
