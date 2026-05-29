"use client";

/**
 * Certificación DIR — Art. 21 NTEC.
 *
 * Solo visible y accesible para usuarios con rol DIR.
 * Lista los documentos en estado 'validado' que esperan certificación formal.
 *
 * Mejoras UX:
 *   - Filtro por servicio (servicio_nombre)
 *   - Indicador de antigüedad con semáforo de color:
 *       verde  < 3 días   — en plazo
 *       ámbar  3-7 días   — próximo a vencer
 *       rojo   > 7 días   — urgente
 *   - Bulk select: seleccionar múltiples documentos y certificar con un PIN único
 *     (usa certificarBulk — todos los documentos se procesan, no solo el primero)
 */

import * as React from "react";
import Link from "next/link";
import {
  Shield,
  ClipboardCheck,
  CheckSquare,
  Square,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Skeleton } from "@his/ui/components/skeleton";
import { Switch } from "@his/ui/components/switch";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type DocumentoItem = {
  id: string;
  tipoDocumentoCodigo: string;
  tipoDocumentoNombre: string;
  pacienteId: string;
  pacienteNombre: string;
  estadoCodigo: string;
  estadoNombre: string;
  version: number;
  validadoPor: string | null;
  validadoPorNombre: string | null;
  creadoEn: string;
  ultimoCambioEn: string;
  servicioNombre?: string | null;
};

type BulkProgress = {
  done: number;
  total: number;
  errors: Array<{ instanciaId: string; error: string }>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Días transcurridos desde la fecha dada. */
function diasDesde(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / 86_400_000);
}

type Semaforo = "verde" | "ambar" | "rojo";

function calcularSemaforo(ultimoCambioEn: string): Semaforo {
  const dias = diasDesde(ultimoCambioEn);
  if (dias < 3) return "verde";
  if (dias <= 7) return "ambar";
  return "rojo";
}

const SEMAFORO_CLASSES: Record<Semaforo, string> = {
  verde: "text-green-700 bg-green-50 border-green-300 dark:text-green-400 dark:bg-green-950/30 dark:border-green-700",
  ambar: "text-amber-700 bg-amber-50 border-amber-300 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-700",
  rojo: "text-red-700 bg-red-50 border-red-300 dark:text-red-400 dark:bg-red-950/30 dark:border-red-700",
};

const SEMAFORO_LABEL: Record<Semaforo, string> = {
  verde: "en plazo",
  ambar: "próximo a vencer",
  rojo: "urgente",
};

function AntigüedadBadge({ ultimoCambioEn }: { ultimoCambioEn: string }) {
  const dias = diasDesde(ultimoCambioEn);
  const semaforo = calcularSemaforo(ultimoCambioEn);
  const Icon = semaforo === "rojo" ? AlertTriangle : Clock;

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        SEMAFORO_CLASSES[semaforo],
      ].join(" ")}
      aria-label={`Antigüedad: ${dias} día${dias === 1 ? "" : "s"} — ${SEMAFORO_LABEL[semaforo]}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {dias}d
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal certificación (individual y bulk)
// ---------------------------------------------------------------------------

function CertificarDialog({
  open,
  count,
  onClose,
  onConfirm,
  isPending,
  bulkProgress,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onConfirm: (pin: string) => void;
  isPending: boolean;
  bulkProgress: BulkProgress | null;
}) {
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPin("");
      setPinError(null);
    }
  }, [open]);

  function handleConfirm() {
    if (!/^\d{6,8}$/.test(pin)) {
      setPinError("El PIN debe tener entre 6 y 8 dígitos numéricos.");
      return;
    }
    setPinError(null);
    onConfirm(pin);
  }

  const isBulk = count > 1;
  const progressPct =
    bulkProgress && bulkProgress.total > 0
      ? Math.round((bulkProgress.done / bulkProgress.total) * 100)
      : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Certificar {count === 1 ? "documento" : `${count} documentos`}
          </DialogTitle>
          <DialogDescription>
            Ingrese su PIN de firma electrónica para certificar formalmente
            {count === 1 ? " este documento" : ` los ${count} documentos seleccionados`}
            {" "}(Art. 21 NTEC). Esta acción es irreversible.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="pin-dir">PIN de firma DIR</Label>
          <Input
            id="pin-dir"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ""));
              setPinError(null);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
            placeholder="6-8 dígitos"
            aria-describedby={pinError ? "pin-dir-error" : undefined}
            aria-invalid={pinError ? true : undefined}
            disabled={isPending}
            autoComplete="current-password"
            autoFocus
          />
          {pinError && (
            <p id="pin-dir-error" role="alert" className="text-xs text-destructive">
              {pinError}
            </p>
          )}
        </div>

        {/* Barra de progreso bulk */}
        {isBulk && bulkProgress && (
          <div className="space-y-1" role="status" aria-live="polite">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progreso</span>
              <span>{bulkProgress.done} / {bulkProgress.total}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-[#1a3c6e] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
                aria-valuenow={bulkProgress.done}
                aria-valuemin={0}
                aria-valuemax={bulkProgress.total}
                role="progressbar"
                aria-label={`Certificando: ${bulkProgress.done} de ${bulkProgress.total}`}
              />
            </div>
            {bulkProgress.errors.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-destructive" role="list" aria-label="Documentos con error">
                {bulkProgress.errors.map((e) => (
                  <li key={e.instanciaId}>
                    Doc {e.instanciaId.slice(0, 8)}…: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={pin.length < 6 || isPending}
            className="bg-[#1a3c6e] hover:bg-[#15305a] text-white"
            aria-busy={isPending}
          >
            {isPending
              ? isBulk
                ? `Certificando ${bulkProgress?.done ?? 0}/${count}…`
                : "Certificando…"
              : "Certificar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Card de documento individual
// ---------------------------------------------------------------------------

function DocumentoCard({
  doc,
  selected,
  onToggleSelect,
  onCertificar,
  disabled,
}: {
  doc: DocumentoItem;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onCertificar: (doc: DocumentoItem) => void;
  disabled: boolean;
}) {
  const yaCertificado = doc.estadoCodigo === "certificado";

  return (
    <Card
      className={[
        "flex flex-col transition-colors",
        selected ? "ring-2 ring-[#1a3c6e]" : "",
        disabled ? "opacity-70" : "",
      ].join(" ")}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            {/* Checkbox de selección bulk */}
            {!yaCertificado && (
              <button
                type="button"
                onClick={() => onToggleSelect(doc.id)}
                disabled={disabled}
                aria-pressed={selected}
                aria-label={
                  selected
                    ? `Deseleccionar ${doc.tipoDocumentoNombre}`
                    : `Seleccionar ${doc.tipoDocumentoNombre} para certificación bulk`
                }
                className="mt-0.5 shrink-0 text-muted-foreground hover:text-[#1a3c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {selected ? (
                  <CheckSquare className="h-5 w-5 text-[#1a3c6e]" aria-hidden />
                ) : (
                  <Square className="h-5 w-5" aria-hidden />
                )}
              </button>
            )}
            <CardTitle className="text-base leading-snug">
              {doc.tipoDocumentoNombre}
            </CardTitle>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {yaCertificado ? (
              <Badge variant="default" aria-label="Estado: Certificado">Certificado</Badge>
            ) : (
              <>
                <Badge variant="secondary" aria-label="Estado: Pendiente de certificar">Pendiente</Badge>
                <AntigüedadBadge ultimoCambioEn={doc.ultimoCambioEn} />
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-2 text-sm">
        <p>
          <span className="text-muted-foreground">Paciente:</span>{" "}
          <span className="font-medium">{doc.pacienteNombre}</span>
        </p>

        {doc.servicioNombre && (
          <p>
            <span className="text-muted-foreground">Servicio:</span>{" "}
            {doc.servicioNombre}
          </p>
        )}

        {doc.validadoPorNombre && (
          <p>
            <span className="text-muted-foreground">Validado por:</span>{" "}
            {doc.validadoPorNombre}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {new Date(doc.creadoEn).toLocaleDateString("es-SV")} — v{doc.version}
        </p>

        <div className="mt-auto flex gap-2 pt-2">
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <Link href={`/ece/epicrisis/${doc.id}`}>Ver</Link>
          </Button>
          {!yaCertificado && (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onCertificar(doc)}
              disabled={disabled}
              aria-label={`Certificar documento de ${doc.pacienteNombre}`}
            >
              Certificar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function CertificacionDirPage() {
  const [incluirCertificados, setIncluirCertificados] = React.useState(false);
  const [filtroServicio, setFiltroServicio] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [bulkMode, setBulkMode] = React.useState(false);
  const [dialogDoc, setDialogDoc] = React.useState<DocumentoItem | null>(null);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = React.useState<BulkProgress | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // HG-06: el router usa cursor pagination — acumulamos páginas en el cliente.
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  const [allDocumentos, setAllDocumentos] = React.useState<DocumentoItem[]>([]);

  const colaQuery = trpc.eceCertificacion.listCola.useQuery({
    incluirCertificados,
    cursor,
  });

  // Acumular documentos en la lista cuando cambia la página.
  React.useEffect(() => {
    if (colaQuery.data?.items) {
      if (!cursor) {
        // Primera página — reemplazar.
        setAllDocumentos(colaQuery.data.items);
      } else {
        // Páginas siguientes — acumular sin duplicados.
        setAllDocumentos((prev) => {
          const existingIds = new Set(prev.map((d) => d.id));
          const newItems = colaQuery.data!.items.filter((d) => !existingIds.has(d.id));
          return [...prev, ...newItems];
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colaQuery.data]);

  const certificarMutation = trpc.eceCertificacion.certificar.useMutation({
    onSuccess: () => {
      setDialogOpen(false);
      setSelected(new Set());
      setBulkMode(false);
      setDialogDoc(null);
      setMutationError(null);
      // Refrescar desde primera página.
      setCursor(undefined);
      setAllDocumentos([]);
      colaQuery.refetch();
    },
    onError: (err: { message: string }) => {
      setMutationError(err.message ?? "Error al certificar. Verifique su PIN.");
    },
  });

  const certificarBulkMutation = trpc.eceCertificacion.certificarBulk.useMutation({
    onSuccess: (data) => {
      setBulkProgress({
        done: data.exitosos.length,
        total: data.exitosos.length + data.fallidos.length,
        errors: data.fallidos,
      });
      setSubmitting(false);

      if (data.fallidos.length === 0) {
        // Todos exitosos — cerrar dialog y refrescar.
        setDialogOpen(false);
        setSelected(new Set());
        setBulkMode(false);
        setBulkProgress(null);
        setMutationError(null);
      } else {
        // Hubo errores parciales — mantener dialog abierto con resumen.
        setMutationError(
          `${data.exitosos.length} certificado(s) correctamente. ${data.fallidos.length} con error (ver detalle abajo).`,
        );
      }
      // Refrescar desde la primera página.
      setCursor(undefined);
      setAllDocumentos([]);
      colaQuery.refetch();
    },
    onError: (err: { message: string }) => {
      setSubmitting(false);
      setMutationError(err.message ?? "Error al certificar en bulk. Verifique su PIN.");
    },
  });

  const documentos: DocumentoItem[] = allDocumentos;

  // Filtrar por servicio
  const documentosFiltrados = filtroServicio
    ? documentos.filter((d) =>
        (d.servicioNombre ?? "")
          .toLowerCase()
          .includes(filtroServicio.toLowerCase()),
      )
    : documentos;

  const pendientes = documentosFiltrados.filter((d) => d.estadoCodigo !== "certificado");

  const isPending = submitting || certificarMutation.isPending || certificarBulkMutation.isPending;

  function handleToggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    const pendienteIds = pendientes.map((d) => d.id);
    setSelected(new Set(pendienteIds));
  }

  function handleClearSelection() {
    setSelected(new Set());
  }

  function handleCertificarOne(doc: DocumentoItem) {
    setDialogDoc(doc);
    setBulkMode(false);
    setMutationError(null);
    setBulkProgress(null);
    setDialogOpen(true);
  }

  function handleBulkCertificar() {
    if (selected.size === 0) return;
    setBulkMode(true);
    setDialogDoc(null);
    setMutationError(null);
    setBulkProgress(null);
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    if (isPending) return;
    setDialogOpen(false);
    setDialogDoc(null);
    setMutationError(null);
    setBulkProgress(null);
  }

  function handleConfirmPin(pin: string) {
    if (bulkMode) {
      // Usa certificarBulk — el servidor verifica PIN una vez y procesa todos.
      const instanciaIds = Array.from(selected);
      setSubmitting(true);
      setBulkProgress({ done: 0, total: instanciaIds.length, errors: [] });
      certificarBulkMutation.mutate({ instanciaIds, pin });
    } else if (dialogDoc) {
      certificarMutation.mutate({ instanciaId: dialogDoc.id, pin });
    }
  }

  const dialogCount = bulkMode ? selected.size : 1;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Shield className="h-6 w-6 text-primary" aria-hidden="true" />
            Certificación DIR
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Certificación formal de documentos ECE — Art. 21 NTEC.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="toggle-certificados" className="text-sm">
            Mostrar certificados
          </Label>
          <Switch
            id="toggle-certificados"
            checked={incluirCertificados}
            onCheckedChange={(v) => {
              setIncluirCertificados(v);
              // HG-06: resetear paginación al cambiar el filtro principal.
              setCursor(undefined);
              setAllDocumentos([]);
            }}
            aria-label="Mostrar documentos ya certificados"
          />
        </div>
      </div>

      {/* Barra de filtros y bulk actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <Label htmlFor="filtro-servicio" className="sr-only">
            Filtrar por servicio
          </Label>
          <Input
            id="filtro-servicio"
            placeholder="Filtrar por servicio…"
            value={filtroServicio}
            onChange={(e) => setFiltroServicio(e.target.value)}
            className="max-w-xs"
            aria-label="Filtrar documentos por nombre de servicio"
          />
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {selected.size} seleccionado{selected.size !== 1 ? "s" : ""}
            </span>
            <Button
              size="sm"
              onClick={handleBulkCertificar}
              aria-label={`Certificar los ${selected.size} documentos seleccionados`}
            >
              Certificar seleccionados
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClearSelection}
              aria-label="Deseleccionar todos"
            >
              Deseleccionar
            </Button>
          </div>
        )}

        {selected.size === 0 && pendientes.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleSelectAll}
            aria-label="Seleccionar todos los documentos pendientes"
          >
            Seleccionar todos
          </Button>
        )}
      </div>

      {/* Error de carga */}
      {colaQuery.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {String(colaQuery.error.message)}
        </div>
      )}

      {/* Error de mutación */}
      {mutationError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {mutationError}
        </div>
      )}

      {/* Cola de documentos */}
      {colaQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-lg" />
          ))}
        </div>
      ) : documentosFiltrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <ClipboardCheck className="mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
          <p className="font-medium">Sin documentos</p>
          <p className="text-sm">
            {filtroServicio
              ? `No se encontraron documentos para el servicio "${filtroServicio}".`
              : incluirCertificados
                ? "No hay documentos certificados en este establecimiento."
                : "No hay documentos en estado 'validado' para certificar."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documentosFiltrados.map((doc) => (
              <DocumentoCard
                key={doc.id}
                doc={doc}
                selected={selected.has(doc.id)}
                onToggleSelect={handleToggleSelect}
                onCertificar={handleCertificarOne}
                disabled={isPending}
              />
            ))}
          </div>
          {/* HG-06: botón "Cargar más" cuando el router indica que hay siguiente cursor */}
          {colaQuery.data?.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={colaQuery.isFetching}
                onClick={() => setCursor(colaQuery.data.nextCursor)}
                aria-label="Cargar más documentos de la cola"
              >
                {colaQuery.isFetching ? "Cargando…" : "Cargar más"}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Modal PIN */}
      <CertificarDialog
        open={dialogOpen}
        count={dialogCount}
        onClose={handleCloseDialog}
        onConfirm={handleConfirmPin}
        isPending={isPending}
        bulkProgress={bulkMode ? bulkProgress : null}
      />
    </div>
  );
}
