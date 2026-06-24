"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { parseDateOnly } from "@/lib/date-only";

// Etiqueta del número de documento según el tipo seleccionado.
function documentNumberLabel(documentType: string): string {
  if (documentType === "DUI" || documentType === "DUI_RESP") return "Número de DUI";
  if (documentType === "DNI") return "Número de DNI";
  if (documentType === "PASAPORTE") return "Número de pasaporte";
  return "Número de documento";
}

/**
 * Registro nuevo paciente (TDR §8.1 + CC-0002 §13.5).
 * Genera un expediente único {PAIS}{AA}{NNNNN} al crear, o recupera el existente
 * si el documento de identidad ya estaba registrado.
 * TODO(Sprint 2): wizard completo con direcciones, alergias, identificadores en el mismo flujo.
 */
export default function NewPatientPage() {
  const router = useRouter();
  const sexes = trpc.catalog.list.useQuery({ catalog: "biologicalSex", activeOnly: true });

  // Paciente creado/recuperado — cuando existe, se muestra el panel de éxito.
  const [created, setCreated] = React.useState<{ id: string; expediente: string | null } | null>(null);

  const create = trpc.patient.create.useMutation({
    onSuccess: (p) => setCreated({ id: p.id, expediente: p.expediente ?? null }),
  });

  const [form, setForm] = React.useState({
    mrn: "",
    firstName: "",
    lastName: "",
    biologicalSexId: "",
    birthDate: "",
    // CC-0002 §13.5 — campos de documento e identificación del responsable.
    documentType: "",
    documentNumber: "",
    responsableNombre: "",
    responsableParentesco: "",
    responsableDui: "",
  });

  // H1-02 (audit Stream A): validación client-side previa al submit — el Select
  // de Shadcn no acepta `required` HTML, así que se enmascara como UUID inválido
  // en el servidor sin feedback visual. Aquí marcamos los campos obligatorios
  // antes de invocar la mutación.
  const [validationError, setValidationError] = React.useState<{
    field: string | null;
    message: string;
  }>({ field: null, message: "" });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.biologicalSexId) {
      setValidationError({
        field: "biologicalSexId",
        message: "Selecciona el sexo biológico — campo obligatorio para protocolos clínicos.",
      });
      return;
    }
    if (!form.birthDate) {
      setValidationError({
        field: "birthDate",
        message: "Ingresa la fecha de nacimiento — requerida para cálculo de edad y rangos pediátricos.",
      });
      return;
    }

    // CC-0002 §13.5 — validaciones de documento e identificación del responsable.
    if (form.documentType && !form.documentNumber) {
      setValidationError({ field: "documentNumber", message: "Ingresa el número de documento." });
      return;
    }
    if (form.documentType === "DUI_RESP") {
      if (!form.responsableNombre) {
        setValidationError({ field: "responsableNombre", message: "Ingresa el nombre del responsable." });
        return;
      }
      if (!form.responsableParentesco) {
        setValidationError({ field: "responsableParentesco", message: "Ingresa el parentesco del responsable." });
        return;
      }
      if (!form.responsableDui) {
        setValidationError({ field: "responsableDui", message: "Ingresa el DUI del responsable." });
        return;
      }
    }

    setValidationError({ field: null, message: "" });

    create.mutate({
      mrn: form.mrn,
      firstName: form.firstName,
      lastName: form.lastName,
      biologicalSexId: form.biologicalSexId,
      // La validación previa `if (!form.birthDate)` garantiza que el string
      // no está vacío y parseDateOnly siempre retorna Date (no null) aquí.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      birthDate: parseDateOnly(form.birthDate)!,
      birthDateEstimated: false,
      isUnknown: false,
      documentType: form.documentType
        ? (form.documentType as "DUI" | "DNI" | "PASAPORTE" | "DUI_RESP")
        : undefined,
      documentNumber: form.documentType ? form.documentNumber : undefined,
      responsable:
        form.documentType === "DUI_RESP"
          ? {
              nombre: form.responsableNombre,
              parentesco: form.responsableParentesco,
              dui: form.responsableDui,
            }
          : undefined,
    });
  };

  // Panel de éxito: se muestra tras una creación o recuperación exitosa.
  if (created) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Nuevo paciente</h1>
        <Card>
          <CardContent className="pt-6">
            <div role="status" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Paciente registrado.{" "}
                {created.expediente ? (
                  <>
                    <span className="font-semibold">Expediente: {created.expediente}</span>
                  </>
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Nuevo paciente</h1>
      <Card>
        <CardHeader>
          <CardTitle>Datos básicos</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit}>
            <FormField>
              <Label htmlFor="mrn">MRN</Label>
              <Input
                id="mrn"
                required
                value={form.mrn}
                onChange={(e) => setForm({ ...form, mrn: e.target.value })}
              />
            </FormField>
            <FormField>
              <Label htmlFor="firstName">Nombre</Label>
              <Input
                id="firstName"
                required
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </FormField>
            <FormField>
              <Label htmlFor="lastName">Apellido</Label>
              <Input
                id="lastName"
                required
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </FormField>
            <FormField>
              <Label htmlFor="biologicalSexId">
                Sexo biológico <span aria-hidden className="text-destructive">*</span>
                <span className="sr-only"> (obligatorio)</span>
              </Label>
              <Select
                value={form.biologicalSexId}
                onValueChange={(v) => {
                  setForm({ ...form, biologicalSexId: v });
                  if (validationError.field === "biologicalSexId") {
                    setValidationError({ field: null, message: "" });
                  }
                }}
              >
                <SelectTrigger
                  id="biologicalSexId"
                  aria-required="true"
                  aria-invalid={validationError.field === "biologicalSexId"}
                  aria-describedby={validationError.field === "biologicalSexId" ? "biologicalSexId-error" : undefined}
                >
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
              {validationError.field === "biologicalSexId" && (
                <p id="biologicalSexId-error" role="alert" className="text-sm text-destructive">
                  {validationError.message}
                </p>
              )}
            </FormField>
            <FormField>
              <Label htmlFor="birthDate">
                Fecha de nacimiento <span aria-hidden className="text-destructive">*</span>
                <span className="sr-only"> (obligatorio)</span>
              </Label>
              <Input
                id="birthDate"
                type="date"
                required
                value={form.birthDate}
                onChange={(e) => {
                  setForm({ ...form, birthDate: e.target.value });
                  if (validationError.field === "birthDate") {
                    setValidationError({ field: null, message: "" });
                  }
                }}
                aria-invalid={validationError.field === "birthDate"}
                aria-describedby={validationError.field === "birthDate" ? "birthDate-error" : undefined}
              />
              {validationError.field === "birthDate" && (
                <p id="birthDate-error" role="alert" className="text-sm text-destructive">
                  {validationError.message}
                </p>
              )}
            </FormField>

            {/* CC-0002 §13.5 — Tipo de documento (opcional) */}
            <FormField>
              <Label htmlFor="documentType">Tipo de documento</Label>
              <Select
                value={form.documentType}
                onValueChange={(v) => {
                  // Al cambiar a un tipo que no es DUI_RESP, limpiar datos del responsable.
                  const responsableClear =
                    v !== "DUI_RESP"
                      ? { responsableNombre: "", responsableParentesco: "", responsableDui: "" }
                      : {};
                  setForm({ ...form, documentType: v, documentNumber: "", ...responsableClear });
                  if (validationError.field === "documentType") {
                    setValidationError({ field: null, message: "" });
                  }
                }}
              >
                <SelectTrigger id="documentType">
                  <SelectValue placeholder="Selecciona (opcional)…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DUI">DUI (Documento Único de Identidad)</SelectItem>
                  <SelectItem value="DNI">DNI (extranjero)</SelectItem>
                  <SelectItem value="PASAPORTE">Pasaporte</SelectItem>
                  <SelectItem value="DUI_RESP">DUI de Responsable (menor de edad)</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            {/* Número de documento: visible solo cuando hay tipo seleccionado */}
            {form.documentType && (
              <FormField>
                <Label htmlFor="documentNumber">{documentNumberLabel(form.documentType)}</Label>
                <Input
                  id="documentNumber"
                  value={form.documentNumber}
                  onChange={(e) => {
                    setForm({ ...form, documentNumber: e.target.value });
                    if (validationError.field === "documentNumber") {
                      setValidationError({ field: null, message: "" });
                    }
                  }}
                  aria-invalid={validationError.field === "documentNumber"}
                  aria-describedby={
                    validationError.field === "documentNumber" ? "documentNumber-error" : undefined
                  }
                />
                {validationError.field === "documentNumber" && (
                  <p id="documentNumber-error" role="alert" className="text-sm text-destructive">
                    {validationError.message}
                  </p>
                )}
              </FormField>
            )}

            {/* Datos del responsable: visible solo para DUI_RESP */}
            {form.documentType === "DUI_RESP" && (
              <fieldset className="space-y-4 rounded-md border p-4">
                <legend className="px-1 text-sm font-semibold">Datos del responsable</legend>
                <FormField>
                  <Label htmlFor="responsableNombre">Nombre del responsable</Label>
                  <Input
                    id="responsableNombre"
                    value={form.responsableNombre}
                    onChange={(e) => {
                      setForm({ ...form, responsableNombre: e.target.value });
                      if (validationError.field === "responsableNombre") {
                        setValidationError({ field: null, message: "" });
                      }
                    }}
                    aria-invalid={validationError.field === "responsableNombre"}
                    aria-describedby={
                      validationError.field === "responsableNombre"
                        ? "responsableNombre-error"
                        : undefined
                    }
                  />
                  {validationError.field === "responsableNombre" && (
                    <p id="responsableNombre-error" role="alert" className="text-sm text-destructive">
                      {validationError.message}
                    </p>
                  )}
                </FormField>
                <FormField>
                  <Label htmlFor="responsableParentesco">Parentesco</Label>
                  <Input
                    id="responsableParentesco"
                    value={form.responsableParentesco}
                    placeholder="Ej. Madre, Padre, Tutor"
                    onChange={(e) => {
                      setForm({ ...form, responsableParentesco: e.target.value });
                      if (validationError.field === "responsableParentesco") {
                        setValidationError({ field: null, message: "" });
                      }
                    }}
                    aria-invalid={validationError.field === "responsableParentesco"}
                    aria-describedby={
                      validationError.field === "responsableParentesco"
                        ? "responsableParentesco-error"
                        : undefined
                    }
                  />
                  {validationError.field === "responsableParentesco" && (
                    <p
                      id="responsableParentesco-error"
                      role="alert"
                      className="text-sm text-destructive"
                    >
                      {validationError.message}
                    </p>
                  )}
                </FormField>
                <FormField>
                  <Label htmlFor="responsableDui">DUI del responsable</Label>
                  <Input
                    id="responsableDui"
                    value={form.responsableDui}
                    onChange={(e) => {
                      setForm({ ...form, responsableDui: e.target.value });
                      if (validationError.field === "responsableDui") {
                        setValidationError({ field: null, message: "" });
                      }
                    }}
                    aria-invalid={validationError.field === "responsableDui"}
                    aria-describedby={
                      validationError.field === "responsableDui" ? "responsableDui-error" : undefined
                    }
                  />
                  {validationError.field === "responsableDui" && (
                    <p id="responsableDui-error" role="alert" className="text-sm text-destructive">
                      {validationError.message}
                    </p>
                  )}
                </FormField>
              </fieldset>
            )}

            <FormError>{create.error?.message}</FormError>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Guardando…" : "Crear paciente"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
