"use client";

/**
 * §17 LIS — Crear orden de laboratorio.
 *
 * Form simple (mismo patrón que /patients/new) con buscador de tests
 * debounced (300ms) → `trpc.lis.test.list.useQuery({ search })`. Tests
 * seleccionados se acumulan en estado local; submit envía
 * `trpc.lis.order.create` con el payload validado por
 * `labOrderCreateInput` (Zod).
 *
 * Validaciones cliente: encounterId/patientId UUIDs, ≥1 test
 * seleccionado. La validación final ocurre server-side.
 *
 * Wave 10: campos costCenterId (solicitante) y ejecutorCostCenterId (ejecutor).
 * El ejecutor se pre-selecciona automáticamente con el centro 2-LAB-CLI.
 * Si el usuario no cambia la selección, el router también asigna el default.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type LabPriority = "ROUTINE" | "URGENT" | "STAT";

interface LabTestRow {
  id: string;
  code: string;
  name: string;
}

interface LabOrderItemInput {
  testId: string;
  notes?: string;
}

interface LabOrderCreateInput {
  encounterId: string;
  patientId: string;
  priority: LabPriority;
  clinicalIndication?: string;
  items: LabOrderItemInput[];
  costCenterId?: string;
  ejecutorCostCenterId?: string;
}

interface LabOrderCreated {
  id: string;
}

interface CostCenterRow {
  id: string;
  code: string;
  name: string;
  tipo: string | null;
}

interface LisAccess {
  test: {
    list: {
      useQuery: (
        input: { search?: string; activeOnly: boolean; limit?: number },
        opts?: { enabled?: boolean },
      ) => { data?: LabTestRow[]; isLoading: boolean };
    };
  };
  order: {
    create: {
      useMutation: (opts: {
        onSuccess?: (data: LabOrderCreated) => void;
        onError?: (err: { message: string }) => void;
      }) => {
        mutate: (input: LabOrderCreateInput) => void;
        isPending: boolean;
        error?: { message: string } | null;
      };
    };
  };
}

interface CostCenterAccess {
  list: {
    useQuery: (
      input?: { tipo?: "productivo" | "intermedio" | "apoyo"; activo?: boolean },
    ) => { data?: CostCenterRow[]; isLoading: boolean };
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Código del laboratorio clínico — usado para pre-seleccionar ejecutor. */
const LAB_CLI_CODE = "2-LAB-CLI";

export default function NewLisOrderPage(): React.ReactElement {
  const router = useRouter();
  const lis = (trpc as unknown as { lis: LisAccess }).lis;
  const costCenter = (trpc as unknown as { costCenter: CostCenterAccess }).costCenter;

  const [encounterId, setEncounterId] = React.useState("");
  const [patientId, setPatientId] = React.useState("");
  const [priority, setPriority] = React.useState<LabPriority>("ROUTINE");
  const [clinicalIndication, setClinicalIndication] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [selected, setSelected] = React.useState<LabTestRow[]>([]);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [costCenterId, setCostCenterId] = React.useState<string>("");
  const [ejecutorCostCenterId, setEjecutorCostCenterId] = React.useState<string>("");

  // Debounce 300ms para no spamear el endpoint mientras el usuario tipea.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const tests = lis.test.list.useQuery(
    { search: debouncedSearch || undefined, activeOnly: true, limit: 20 },
    { enabled: debouncedSearch.length > 0 },
  );

  // Centros productivos + intermedios para el solicitante.
  const solicitanteCenters = costCenter.list.useQuery({ activo: true });
  // Centros intermedios para el ejecutor (solo tipo intermedio como 2-LAB-CLI).
  const ejecutorCenters = costCenter.list.useQuery({ tipo: "intermedio", activo: true });

  // Pre-seleccionar ejecutor con 2-LAB-CLI en cuanto se carguen los centros.
  React.useEffect(() => {
    if (ejecutorCenters.data && !ejecutorCostCenterId) {
      const labCli = ejecutorCenters.data.find((c) => c.code === LAB_CLI_CODE);
      if (labCli) setEjecutorCostCenterId(labCli.id);
    }
  }, [ejecutorCenters.data, ejecutorCostCenterId]);

  const create = lis.order.create.useMutation({
    onSuccess: () => {
      router.push("/lis/orders");
    },
    onError: (err) => setSubmitError(err.message),
  });

  function addTest(t: LabTestRow): void {
    setSelected((prev) =>
      prev.some((x) => x.id === t.id) ? prev : [...prev, t],
    );
  }

  function removeTest(id: string): void {
    setSelected((prev) => prev.filter((t) => t.id !== id));
  }

  const validUuids = UUID_RE.test(encounterId) && UUID_RE.test(patientId);
  const canSubmit = validUuids && selected.length > 0 && !create.isPending;

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmitError(null);
    if (!canSubmit) {
      if (!validUuids) {
        setSubmitError("encounterId y patientId deben ser UUID válidos.");
      } else if (selected.length === 0) {
        setSubmitError("Selecciona al menos un test.");
      }
      return;
    }
    create.mutate({
      encounterId,
      patientId,
      priority,
      ...(clinicalIndication.trim() && {
        clinicalIndication: clinicalIndication.trim(),
      }),
      items: selected.map((t) => ({ testId: t.id })),
      ...(costCenterId && { costCenterId }),
      ...(ejecutorCostCenterId && { ejecutorCostCenterId }),
    });
  }

  // Filtra centros solicitantes a productivo + intermedio (excluye apoyo).
  const centrosSolicitantes = (solicitanteCenters.data ?? []).filter(
    (c) => c.tipo === "productivo" || c.tipo === "intermedio" || c.tipo === null,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Nueva orden de laboratorio</h1>
        <Button asChild variant="outline">
          <Link href="/lis/orders">Cancelar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la orden</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit}>
            <FormField>
              <Label htmlFor="encounterId">Encuentro (UUID)</Label>
              <Input
                id="encounterId"
                required
                value={encounterId}
                onChange={(e) => setEncounterId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                aria-invalid={
                  encounterId.length > 0 && !UUID_RE.test(encounterId)
                }
              />
            </FormField>

            <FormField>
              <Label htmlFor="patientId">Paciente (UUID)</Label>
              <Input
                id="patientId"
                required
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                aria-invalid={
                  patientId.length > 0 && !UUID_RE.test(patientId)
                }
              />
            </FormField>

            <FormField>
              <Label>Prioridad</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as LabPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROUTINE">Rutina</SelectItem>
                  <SelectItem value="URGENT">Urgente</SelectItem>
                  <SelectItem value="STAT">STAT</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <Label htmlFor="clinical">Indicación clínica</Label>
              <textarea
                id="clinical"
                value={clinicalIndication}
                onChange={(e) => setClinicalIndication(e.target.value)}
                rows={3}
                maxLength={2000}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Sospecha clínica, diagnóstico de trabajo, etc."
              />
            </FormField>

            <FormField>
              <Label htmlFor="cost-center-solicitante">
                Centro solicitante{" "}
                <span className="text-xs text-muted-foreground">(opcional)</span>
              </Label>
              <Select
                value={costCenterId}
                onValueChange={setCostCenterId}
                disabled={solicitanteCenters.isLoading}
              >
                <SelectTrigger id="cost-center-solicitante">
                  <SelectValue placeholder="Seleccionar centro..." />
                </SelectTrigger>
                <SelectContent>
                  {centrosSolicitantes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="font-mono text-xs">{c.code}</span>
                      <span className="ml-2">{c.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <Label htmlFor="cost-center-ejecutor">
                Centro ejecutor{" "}
                <span className="text-xs text-muted-foreground">(opcional — por defecto: {LAB_CLI_CODE})</span>
              </Label>
              <Select
                value={ejecutorCostCenterId}
                onValueChange={setEjecutorCostCenterId}
                disabled={ejecutorCenters.isLoading}
              >
                <SelectTrigger id="cost-center-ejecutor">
                  <SelectValue placeholder="Seleccionar centro ejecutor..." />
                </SelectTrigger>
                <SelectContent>
                  {(ejecutorCenters.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="font-mono text-xs">{c.code}</span>
                      <span className="ml-2">{c.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <Label htmlFor="test-search">Buscar tests</Label>
              <Input
                id="test-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Código o nombre del test (mín. 1 caracter)"
                aria-controls="test-search-results"
                aria-expanded={debouncedSearch.length > 0}
              />
              {debouncedSearch.length > 0 ? (
                <ul
                  id="test-search-results"
                  role="listbox"
                  className="mt-2 max-h-56 divide-y overflow-auto rounded-md border"
                >
                  {tests.isLoading ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      Buscando…
                    </li>
                  ) : null}
                  {!tests.isLoading && (tests.data?.length ?? 0) === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      Sin resultados.
                    </li>
                  ) : null}
                  {tests.data?.map((t) => {
                    const already = selected.some((x) => x.id === t.id);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={already}
                          disabled={already}
                          onClick={() => addTest(t)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                        >
                          <span>
                            <span className="font-mono text-xs">{t.code}</span>
                            <span className="ml-2">{t.name}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {already ? "Agregado" : "Agregar"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </FormField>

            <FormField>
              <Label>Tests seleccionados ({selected.length})</Label>
              {selected.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aún no agregaste ningún test.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {selected.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span>
                        <span className="font-mono text-xs">{t.code}</span>
                        <span className="ml-2">{t.name}</span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => removeTest(t.id)}
                        aria-label={`Quitar ${t.name}`}
                      >
                        Quitar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </FormField>

            <FormError>{submitError ?? create.error?.message}</FormError>
            <Button type="submit" disabled={!canSubmit}>
              {create.isPending ? "Creando…" : "Crear orden"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
