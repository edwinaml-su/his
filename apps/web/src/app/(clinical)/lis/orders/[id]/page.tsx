"use client";

/**
 * §17 LIS — Detalle de orden de laboratorio.
 *
 * - Header: paciente, encuentro, prioridad, status.
 * - Sección "Especímenes": tabla + dialog "Recolectar espécimen"
 *   (`trpc.lis.specimen.collect`).
 * - Sección "Tests + resultados": un row por item; dialogs para
 *   "Ingresar resultado" (`trpc.lis.result.enter`) y botón "Validar"
 *   (`trpc.lis.result.validate`).
 *
 * Regla 4-eyes: si validate retorna FORBIDDEN, mostramos un mensaje
 * accesible con role="alert" indicando que no podés validar tu propio
 * resultado.
 */
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import {
  ResultFlagBadge,
  type ResultFlag,
} from "../../_components/result-flag-badge";

type LabPriority = "ROUTINE" | "URGENT" | "STAT";
type LabOrderStatus =
  | "DRAFT"
  | "ORDERED"
  | "COLLECTED"
  | "IN_PROCESS"
  | "RESULTED"
  | "VALIDATED"
  | "CANCELLED";
type SpecimenType =
  | "BLOOD"
  | "URINE"
  | "STOOL"
  | "CSF"
  | "SWAB"
  | "TISSUE"
  | "SALIVA"
  | "OTHER";
type SpecimenCondition =
  | "ACCEPTABLE"
  | "REJECTED"
  | "HEMOLYZED"
  | "CLOTTED"
  | "INSUFFICIENT";

interface LabResultRow {
  id: string;
  valueNumeric: number | null;
  valueText: string | null;
  valueUnit: string | null;
  flag: ResultFlag;
  notes: string | null;
  resultedById: string;
  validatedAt: string | Date | null;
  validatedById: string | null;
}

interface LabOrderItemRow {
  id: string;
  test: { id: string; code: string; name: string };
  notes: string | null;
  results: LabResultRow[];
}

interface LabSpecimenRow {
  id: string;
  type: SpecimenType;
  barcode: string;
  condition: SpecimenCondition;
  collectedAt: string | Date;
}

interface LabOrderDetail {
  id: string;
  patientId: string;
  encounterId: string;
  patient?: { firstName: string; lastName: string; mrn: string } | null;
  encounter?: { encounterNumber: string } | null;
  priority: LabPriority;
  status: LabOrderStatus;
  clinicalIndication: string | null;
  orderedAt: string | Date;
  items: LabOrderItemRow[];
  specimens: LabSpecimenRow[];
}

interface SpecimenCollectInput {
  orderId: string;
  type: SpecimenType;
  barcode: string;
  collectedAt?: Date;
}

interface ResultEnterInput {
  orderItemId: string;
  specimenId?: string;
  valueNumeric?: number;
  valueText?: string;
  valueUnit?: string;
  flag: ResultFlag;
  notes?: string;
}

interface ValidateError {
  message: string;
  data?: { code?: string };
}

interface LisOrderAccess {
  get: {
    useQuery: (input: { id: string }) => {
      data?: LabOrderDetail;
      isLoading: boolean;
      error?: { message: string } | null;
      refetch: () => Promise<unknown>;
    };
  };
}

interface LisSpecimenAccess {
  collect: {
    useMutation: (opts: {
      onSuccess?: () => void;
      onError?: (err: { message: string }) => void;
    }) => {
      mutate: (input: SpecimenCollectInput) => void;
      isPending: boolean;
      error?: { message: string } | null;
    };
  };
}

interface LisResultAccess {
  enter: {
    useMutation: (opts: {
      onSuccess?: () => void;
      onError?: (err: { message: string }) => void;
    }) => {
      mutate: (input: ResultEnterInput) => void;
      isPending: boolean;
      error?: { message: string } | null;
    };
  };
  validate: {
    useMutation: (opts: {
      onSuccess?: () => void;
      onError?: (err: ValidateError) => void;
    }) => {
      mutate: (input: { resultId: string }) => void;
      isPending: boolean;
    };
  };
}

interface LisAccess {
  order: LisOrderAccess;
  specimen: LisSpecimenAccess;
  result: LisResultAccess;
}

const PRIORITY_LABEL: Record<LabPriority, string> = {
  ROUTINE: "Rutina",
  URGENT: "Urgente",
  STAT: "STAT",
};

const PRIORITY_BADGE: Record<LabPriority, string> = {
  ROUTINE: "bg-slate-100 text-slate-700",
  URGENT: "bg-amber-100 text-amber-800",
  STAT: "bg-red-100 text-red-700 font-bold",
};

const STATUS_LABEL: Record<LabOrderStatus, string> = {
  DRAFT: "Borrador",
  ORDERED: "Solicitada",
  COLLECTED: "Recolectada",
  IN_PROCESS: "En proceso",
  RESULTED: "Con resultado",
  VALIDATED: "Validada",
  CANCELLED: "Cancelada",
};

const SPECIMEN_TYPE_LABEL: Record<SpecimenType, string> = {
  BLOOD: "Sangre",
  URINE: "Orina",
  STOOL: "Heces",
  CSF: "LCR",
  SWAB: "Hisopado",
  TISSUE: "Tejido",
  SALIVA: "Saliva",
  OTHER: "Otro",
};

const RESULT_FLAGS: ResultFlag[] = [
  "NORMAL",
  "LOW",
  "HIGH",
  "CRITICAL_LOW",
  "CRITICAL_HIGH",
  "ABNORMAL",
];

const NO_SPECIMEN = "__NONE__";

export default function LisOrderDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  // HH-10 (audit Stream H): lis está montado en _app.ts — acceso directo.
  const lis = trpc.lis as unknown as LisAccess;
  const order = lis.order.get.useQuery({ id });

  const [collectOpen, setCollectOpen] = React.useState(false);
  const [resultOpenItemId, setResultOpenItemId] = React.useState<string | null>(
    null,
  );
  const [validateError, setValidateError] = React.useState<string | null>(null);

  // Una sola instancia de la mutation a nivel página: evita reglas-de-hooks
  // dentro de mapas y centraliza el feedback de errores (4-eyes / NOT_FOUND).
  const validate = lis.result.validate.useMutation({
    onSuccess: () => {
      setValidateError(null);
      void order.refetch();
    },
    onError: (err) => {
      const code = err.data?.code;
      if (code === "FORBIDDEN") {
        setValidateError("No podés validar tu propio resultado (regla 4-eyes).");
      } else {
        setValidateError(err.message);
      }
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Orden de laboratorio</h1>
      </div>

      {order.error ? (
        <p role="alert" className="text-sm text-destructive">
          {order.error.message}
        </p>
      ) : null}
      {order.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : null}

      {order.data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Datos generales</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Paciente</dt>
                  <dd>
                    {order.data.patient
                      ? `${order.data.patient.firstName} ${order.data.patient.lastName}`
                      : order.data.patientId}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Encuentro</dt>
                  <dd className="font-mono text-xs">
                    {order.data.encounter?.encounterNumber ??
                      order.data.encounterId.slice(0, 8)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Prioridad</dt>
                  <dd>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${PRIORITY_BADGE[order.data.priority]}`}
                    >
                      {PRIORITY_LABEL[order.data.priority]}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Estado</dt>
                  <dd>{STATUS_LABEL[order.data.status]}</dd>
                </div>
                {order.data.clinicalIndication ? (
                  <div className="col-span-2 md:col-span-4">
                    <dt className="text-xs text-muted-foreground">
                      Indicación clínica
                    </dt>
                    <dd>{order.data.clinicalIndication}</dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Especímenes ({order.data.specimens.length})</CardTitle>
              <Button size="sm" onClick={() => setCollectOpen(true)}>
                Recolectar espécimen
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Condición</TableHead>
                    <TableHead>Recolección</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.data.specimens.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center text-sm text-muted-foreground"
                      >
                        Sin especímenes recolectados.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {order.data.specimens.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{SPECIMEN_TYPE_LABEL[s.type]}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {s.barcode}
                      </TableCell>
                      <TableCell>{s.condition}</TableCell>
                      <TableCell className="tabular-nums">
                        {new Date(s.collectedAt).toLocaleString("es-SV")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tests y resultados</CardTitle>
            </CardHeader>
            <CardContent>
              {validateError ? (
                <p role="alert" className="mb-3 text-sm font-medium text-destructive">
                  {validateError}
                </p>
              ) : null}
              <ul className="divide-y">
                {order.data.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onValidate={(resultId) => validate.mutate({ resultId })}
                    validating={validate.isPending}
                    onEnterResult={() => setResultOpenItemId(item.id)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>

          <CollectSpecimenDialog
            open={collectOpen}
            onOpenChange={setCollectOpen}
            orderId={order.data.id}
            lis={lis}
            onSuccess={() => {
              setCollectOpen(false);
              void order.refetch();
            }}
          />

          {resultOpenItemId ? (
            <EnterResultDialog
              open={Boolean(resultOpenItemId)}
              onOpenChange={(o) => {
                if (!o) setResultOpenItemId(null);
              }}
              orderItemId={resultOpenItemId}
              specimens={order.data.specimens}
              lis={lis}
              onSuccess={() => {
                setResultOpenItemId(null);
                void order.refetch();
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

interface ItemRowProps {
  item: LabOrderItemRow;
  onEnterResult: () => void;
  onValidate: (resultId: string) => void;
  validating: boolean;
}

function ItemRow({
  item,
  onEnterResult,
  onValidate,
  validating,
}: ItemRowProps): React.ReactElement {
  const hasResult = item.results.length > 0;
  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div>
            <span className="font-mono text-xs">{item.test.code}</span>
            <span className="ml-2 font-medium">{item.test.name}</span>
          </div>
          {item.notes ? (
            <p className="text-xs text-muted-foreground">{item.notes}</p>
          ) : null}
        </div>
        {!hasResult ? (
          <Button size="sm" variant="outline" onClick={onEnterResult}>
            Ingresar resultado
          </Button>
        ) : null}
      </div>
      {hasResult ? (
        <ul className="mt-2 space-y-1.5 pl-2 text-sm">
          {item.results.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-3">
                <ResultFlagBadge flag={r.flag} />
                <span className="tabular-nums">
                  {r.valueNumeric !== null
                    ? r.valueNumeric
                    : (r.valueText ?? "—")}
                  {r.valueUnit ? ` ${r.valueUnit}` : ""}
                </span>
                {r.notes ? (
                  <span className="text-xs text-muted-foreground">
                    {r.notes}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {r.validatedAt ? (
                  <span className="text-xs text-muted-foreground">
                    Validado {new Date(r.validatedAt).toLocaleString("es-SV")}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    disabled={validating}
                    onClick={() => onValidate(r.id)}
                  >
                    {validating ? "Validando…" : "Validar"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface CollectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  lis: LisAccess;
  onSuccess: () => void;
}

function CollectSpecimenDialog({
  open,
  onOpenChange,
  orderId,
  lis,
  onSuccess,
}: CollectDialogProps): React.ReactElement {
  const [type, setType] = React.useState<SpecimenType>("BLOOD");
  const [barcode, setBarcode] = React.useState("");
  const [collectedAt, setCollectedAt] = React.useState("");
  const collect = lis.specimen.collect.useMutation({
    onSuccess,
  });

  const canSubmit =
    barcode.trim().length > 0 &&
    barcode.trim().length <= 80 &&
    !collect.isPending;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    collect.mutate({
      orderId,
      type,
      barcode: barcode.trim(),
      ...(collectedAt && { collectedAt: new Date(collectedAt) }),
    });
  }

  // Reset al cerrar — evita arrastrar valores entre aperturas sucesivas.
  React.useEffect(() => {
    if (!open) {
      setBarcode("");
      setCollectedAt("");
      setType("BLOOD");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recolectar espécimen</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="specimen-type">Tipo</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as SpecimenType)}
            >
              <SelectTrigger id="specimen-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SPECIMEN_TYPE_LABEL) as SpecimenType[]).map(
                  (t) => (
                    <SelectItem key={t} value={t}>
                      {SPECIMEN_TYPE_LABEL[t]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="barcode">Barcode</Label>
            <Input
              id="barcode"
              required
              maxLength={80}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="collectedAt">Fecha y hora de recolección</Label>
            <Input
              id="collectedAt"
              type="datetime-local"
              value={collectedAt}
              onChange={(e) => setCollectedAt(e.target.value)}
            />
          </div>
          {collect.error ? (
            <p
              role="alert"
              className="text-xs font-medium text-destructive"
            >
              {collect.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {collect.isPending ? "Guardando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EnterResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderItemId: string;
  specimens: LabSpecimenRow[];
  lis: LisAccess;
  onSuccess: () => void;
}

function EnterResultDialog({
  open,
  onOpenChange,
  orderItemId,
  specimens,
  lis,
  onSuccess,
}: EnterResultDialogProps): React.ReactElement {
  const [valueText, setValueText] = React.useState("");
  const [valueNumeric, setValueNumeric] = React.useState("");
  const [valueUnit, setValueUnit] = React.useState("");
  const [flag, setFlag] = React.useState<ResultFlag>("NORMAL");
  const [notes, setNotes] = React.useState("");
  const [specimenId, setSpecimenId] = React.useState<string>(NO_SPECIMEN);
  const enter = lis.result.enter.useMutation({ onSuccess });

  const numericTrimmed = valueNumeric.trim();
  const numericVal = numericTrimmed.length > 0 ? Number(numericTrimmed) : undefined;
  const numericInvalid =
    numericTrimmed.length > 0 &&
    (Number.isNaN(numericVal) || !Number.isFinite(numericVal as number));
  const hasValue =
    (numericVal !== undefined && !numericInvalid) ||
    valueText.trim().length > 0;
  const canSubmit = hasValue && !enter.isPending;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    enter.mutate({
      orderItemId,
      ...(specimenId !== NO_SPECIMEN && { specimenId }),
      ...(numericVal !== undefined &&
        !numericInvalid && { valueNumeric: numericVal }),
      ...(valueText.trim() && { valueText: valueText.trim() }),
      ...(valueUnit.trim() && { valueUnit: valueUnit.trim() }),
      flag,
      ...(notes.trim() && { notes: notes.trim() }),
    });
  }

  React.useEffect(() => {
    if (!open) {
      setValueText("");
      setValueNumeric("");
      setValueUnit("");
      setFlag("NORMAL");
      setNotes("");
      setSpecimenId(NO_SPECIMEN);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ingresar resultado</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {specimens.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="specimen-link">Espécimen (opcional)</Label>
              <Select value={specimenId} onValueChange={setSpecimenId}>
                <SelectTrigger id="specimen-link">
                  <SelectValue placeholder="Sin asociar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SPECIMEN}>Sin asociar</SelectItem>
                  {specimens.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {SPECIMEN_TYPE_LABEL[s.type]} · {s.barcode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="valueNumeric">Valor numérico</Label>
              <Input
                id="valueNumeric"
                type="number"
                step="any"
                value={valueNumeric}
                onChange={(e) => setValueNumeric(e.target.value)}
                autoFocus
                aria-invalid={numericInvalid}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valueUnit">Unidad</Label>
              <Input
                id="valueUnit"
                value={valueUnit}
                onChange={(e) => setValueUnit(e.target.value)}
                placeholder="mg/dL, mmol/L, …"
                maxLength={40}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="valueText">Valor texto (cualitativo)</Label>
            <Input
              id="valueText"
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
              placeholder="Positivo / Negativo / Reactivo…"
              maxLength={800}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="result-flag">Flag</Label>
            <Select
              value={flag}
              onValueChange={(v) => setFlag(v as ResultFlag)}
            >
              <SelectTrigger id="result-flag">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESULT_FLAGS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="result-notes">Notas</Label>
            <Input
              id="result-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
          </div>
          {enter.error ? (
            <p
              role="alert"
              className="text-xs font-medium text-destructive"
            >
              {enter.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {enter.isPending ? "Guardando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
