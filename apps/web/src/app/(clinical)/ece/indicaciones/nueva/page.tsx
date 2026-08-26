"use client";

/**
 * ECE — Nueva indicación médica (CPOE, CC-0026 Ola 2).
 *
 * Rediseño al mockup ESP-MOCKUP-0026 (`docs/CC/0026/`): grid de 8 categorías
 * (mov/dieta/cuidados/med/lab/gab/proc/inter), cada una con un modal de
 * captura que arma texto (`descripcion`) + payload estructurado (`detalle`,
 * SQL 211) y agrega líneas a un cuadro read-only por categoría. La barra de
 * tipo de indicación (Inicial/Subsecuente) + firma vive en `_components/
 * indicacion-bar.tsx`; el server (`firmar()`) valida tipo y el plazo de 32h
 * — el chip de esta barra es solo informativo.
 *
 * EXTIENDE el CPOE legacy existente (no crea ruta paralela — regla
 * "adecuar legacy" del CLAUDE.md): mismos endpoints
 * `trpc.eceIndicaciones.{create,firmar}`, mismo redirect a /ece/indicaciones.
 *
 * "Guardar borrador" se conserva (capacidad previa del state machine
 * borrador→firmado) aunque el mockup no lo modela — es un botón secundario,
 * no forma parte del grid de categorías, así que no compite con la fidelidad
 * visual del mockup.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import {
  CATEGORIAS,
  CATEGORIA_BY_KEY,
  type CategoriaKey,
  type EntradaCategoria,
  type TipoItemBackend,
} from "./_components/cats-config";
import { CategoriaGrid } from "./_components/categoria-card";
import { IndicacionBar, type SubtipoFirma, type TipoFirma } from "./_components/indicacion-bar";
import { resolveSedeTipo } from "./_components/movimiento-catalogo";
import { ModalMovimiento, type ModalMovimientoHandle } from "./_components/modal-movimiento";
import { ModalDieta, type ModalDietaHandle } from "./_components/modal-dieta";
import { ModalCuidados, type ModalCuidadosHandle } from "./_components/modal-cuidados";
import { ModalMedicamento, type ModalMedicamentoHandle } from "./_components/modal-medicamento";
import { ModalLaboratorio, type ModalLaboratorioHandle } from "./_components/modal-laboratorio";
import { ModalGabinete, type ModalGabineteHandle } from "./_components/modal-gabinete";
import { ModalProcedimiento, type ModalProcedimientoHandle } from "./_components/modal-procedimiento";
import { ModalInterconsulta, type ModalInterconsultaHandle } from "./_components/modal-interconsulta";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ViaAdmin =
  | "ORAL" | "IV" | "IM" | "SC" | "TOPICAL" | "INHALED" | "RECTAL"
  | "SUBLINGUAL" | "OPHTHALMIC" | "OTIC" | "NASAL";
type Frecuencia =
  | "QD" | "BID" | "TID" | "QID" | "Q4H" | "Q6H" | "Q8H" | "Q12H" | "Q24H" | "STAT" | "PRN";

function emptyEntradas(): Record<CategoriaKey, EntradaCategoria[]> {
  const out = {} as Record<CategoriaKey, EntradaCategoria[]>;
  for (const c of CATEGORIAS) out[c.key] = [];
  return out;
}

let _lineId = 0;
const nextLineId = () => `linea_${Date.now()}_${++_lineId}`;

type ToastState = { title: string; description?: string; variant?: "default" | "destructive" } | null;

export default function NuevaIndicacionPage(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  const episodioIdFromUrl = searchParams.get("episodioId") ?? "";
  const [episodioId, setEpisodioId] = React.useState(episodioIdFromUrl);
  const isEpisodioFromUrl = episodioIdFromUrl.length > 0;
  const episodioValido = UUID_RE.test(episodioId.trim());

  const [entradas, setEntradas] = React.useState<Record<CategoriaKey, EntradaCategoria[]>>(
    emptyEntradas,
  );
  const [openCat, setOpenCat] = React.useState<CategoriaKey | null>(null);
  const [toast, setToast] = React.useState<ToastState>(null);
  const [tipo, setTipo] = React.useState<TipoFirma>("INICIAL");
  const [subtipo, setSubtipo] = React.useState<SubtipoFirma>("Indicación diaria");

  // ── contexto: sede activa (para "mov") + última firma del episodio (chip) ──
  const sedeQ = trpc.eceIndicaciones.contextoSede.useQuery();
  const sedeTipo = resolveSedeTipo(sedeQ.data?.establishmentName ?? null);

  const listQ = trpc.eceIndicaciones.list.useQuery(
    { episodioId: episodioId.trim(), limit: 50 },
    { enabled: episodioValido },
  );
  const { hasPrevious, ultimaFirmaMs } = React.useMemo(() => {
    const items = listQ.data?.items ?? [];
    const firmadas = items.filter(
      (i) => i.estado_registro === "firmado" || i.estado_registro === "validado",
    );
    if (firmadas.length === 0) return { hasPrevious: false, ultimaFirmaMs: null as number | null };
    const fechas = firmadas
      .map((i) => (i.fecha_firma ? new Date(i.fecha_firma).getTime() : null))
      .filter((n): n is number => n !== null);
    return { hasPrevious: true, ultimaFirmaMs: fechas.length ? Math.max(...fechas) : null };
  }, [listQ.data]);

  React.useEffect(() => {
    setTipo(hasPrevious ? "SUBSECUENTE" : "INICIAL");
  }, [hasPrevious]);

  // ── refs de los modales (compose() de cada categoría) ──────────────────────
  const movRef = React.useRef<ModalMovimientoHandle>(null);
  const dietaRef = React.useRef<ModalDietaHandle>(null);
  const cuidadosRef = React.useRef<ModalCuidadosHandle>(null);
  const medRef = React.useRef<ModalMedicamentoHandle>(null);
  const labRef = React.useRef<ModalLaboratorioHandle>(null);
  const gabRef = React.useRef<ModalGabineteHandle>(null);
  const procRef = React.useRef<ModalProcedimientoHandle>(null);
  const interRef = React.useRef<ModalInterconsultaHandle>(null);

  function agregarLinea(key: CategoriaKey, r: {
    descripcion: string;
    detalle: Record<string, unknown>;
    drugId?: string;
    dosis?: string;
    via?: string;
    frecuencia?: string;
    duracion?: string;
  } | null) {
    if (!r) return;
    setEntradas((prev) => ({
      ...prev,
      [key]: [...prev[key], { id: nextLineId(), ...r }],
    }));
    setOpenCat(null);
  }

  function handleAgregarDesdeModal() {
    switch (openCat) {
      case "mov": return agregarLinea("mov", movRef.current?.compose() ?? null);
      case "dieta": return agregarLinea("dieta", dietaRef.current?.compose() ?? null);
      case "cuidados": return agregarLinea("cuidados", cuidadosRef.current?.compose() ?? null);
      case "med": return agregarLinea("med", medRef.current?.compose() ?? null);
      case "lab": return agregarLinea("lab", labRef.current?.compose() ?? null);
      case "gab": return agregarLinea("gab", gabRef.current?.compose() ?? null);
      case "proc": return agregarLinea("proc", procRef.current?.compose() ?? null);
      case "inter": return agregarLinea("inter", interRef.current?.compose() ?? null);
      default: return;
    }
  }

  function quitarLinea(key: CategoriaKey, id: string) {
    setEntradas((prev) => ({ ...prev, [key]: prev[key].filter((l) => l.id !== id) }));
  }

  function buildItems() {
    const items: Array<{
      tipo: TipoItemBackend;
      descripcion: string;
      detalle?: Record<string, unknown>;
      drugId?: string;
      dosis?: string;
      via?: ViaAdmin;
      frecuencia?: Frecuencia;
      duracion?: string;
    }> = [];
    for (const cat of CATEGORIAS) {
      for (const e of entradas[cat.key]) {
        items.push({
          tipo: cat.tipoItem,
          descripcion: e.descripcion,
          detalle: e.detalle,
          drugId: e.drugId,
          dosis: e.dosis,
          via: e.via as ViaAdmin | undefined,
          frecuencia: e.frecuencia as Frecuencia | undefined,
          duracion: e.duracion,
        });
      }
    }
    return items;
  }

  const totalRenglones = CATEGORIAS.reduce((acc, c) => acc + entradas[c.key].length, 0);
  const esDiaria = tipo === "SUBSECUENTE" && subtipo === "Indicación diaria";
  const diariaCompleta = CATEGORIAS.every((c) => entradas[c.key].length > 0);
  const puedeFirmar = episodioValido && (esDiaria ? diariaCompleta : totalRenglones > 0);

  const [serverError, setServerError] = React.useState<string | null>(null);

  const createMutation = trpc.eceIndicaciones.create.useMutation({
    onError: (err) => setServerError(err.message),
  });
  const firmarMutation = trpc.eceIndicaciones.firmar.useMutation({
    onError: (err) => setServerError(err.message),
  });

  const isPending = createMutation.isPending || firmarMutation.isPending;

  function handleGuardarBorrador() {
    if (!episodioValido) {
      setServerError("Episodio requerido (acceder desde el episodio hospitalario).");
      return;
    }
    const items = buildItems();
    if (items.length === 0) {
      setServerError("Agregue al menos un ítem en alguna categoría.");
      return;
    }
    setServerError(null);
    createMutation.mutate(
      { episodioId: episodioId.trim(), items },
      { onSuccess: () => router.push("/ece/indicaciones") },
    );
  }

  function handleFirmar() {
    if (!episodioValido) {
      setServerError("Episodio requerido (acceder desde el episodio hospitalario).");
      return;
    }
    const items = buildItems();
    if (items.length === 0) {
      setServerError("Agregue al menos un ítem en alguna categoría.");
      return;
    }
    setServerError(null);
    createMutation.mutate(
      { episodioId: episodioId.trim(), items },
      {
        onSuccess: (data) => {
          firmarMutation.mutate(
            { id: data.id, tipoIndicacion: tipo },
            {
              onSuccess: (res) => {
                setToast({
                  title: "Indicación firmada",
                  // CC-0026 D2 (corrección Edwin 2026-08-26) — lab/gabinete generan
                  // orden real en vez de tarea de enfermería; el toast informa las tres cosas.
                  description: `${res.tasksCreated} tarea(s) de enfermería · ${res.labOrdersCreated} orden(es) de laboratorio · ${res.imagingRequestsCreated} solicitud(es) de imágenes generada(s).${res.ordenesOmitidas.length > 0 ? ` ⚠ ${res.ordenesOmitidas.length} ítem(s) no generaron orden real: ${res.ordenesOmitidas.map((o) => o.motivo).join(" ")}` : ""}${res.plazoExcedido ? " ⚠ Se excedió el plazo de 32h desde la última firma." : ""}`,
                });
                router.push("/ece/indicaciones");
              },
            },
          );
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva indicación médica</h1>
        <p className="text-sm text-muted-foreground">
          Prescripción CPOE por categorías (NTEC Doc 6).
        </p>
      </div>

      <div className="space-y-1 rounded-lg border bg-card p-4">
        <Label htmlFor="episodioId">
          Episodio <span className="text-destructive">*</span>
        </Label>
        <Input
          id="episodioId"
          value={episodioId}
          onChange={(e) => setEpisodioId(e.target.value)}
          placeholder={isEpisodioFromUrl ? undefined : "Pegue el UUID del episodio (acceso admin)"}
          aria-invalid={episodioId.length > 0 && !episodioValido}
          data-testid="input-episodio-id"
          readOnly={isEpisodioFromUrl}
          disabled={isEpisodioFromUrl}
        />
        {isEpisodioFromUrl ? (
          <p className="text-xs text-muted-foreground">Episodio cargado desde la ficha hospitalaria.</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Acceder desde &quot;Episodio hospitalario → Nueva indicación&quot; carga el episodio automáticamente.
          </p>
        )}
        {episodioId.length > 0 && !episodioValido ? (
          <p className="text-xs text-destructive">El identificador del episodio no es un UUID válido.</p>
        ) : null}
      </div>

      <IndicacionBar
        hasPrevious={hasPrevious}
        ultimaFirmaMs={ultimaFirmaMs}
        tipo={tipo}
        onChangeTipo={setTipo}
        subtipo={subtipo}
        onChangeSubtipo={setSubtipo}
        totalRenglones={totalRenglones}
        disabled={!puedeFirmar}
        pending={isPending}
        onFirmar={handleFirmar}
      />

      <CategoriaGrid
        entradas={entradas}
        diariaPendientes={esDiaria}
        onAbrir={setOpenCat}
        onQuitar={quitarLinea}
      />

      {serverError ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </p>
      ) : null}

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/ece/indicaciones")}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || totalRenglones === 0}
          onClick={handleGuardarBorrador}
          data-testid="btn-guardar-borrador"
        >
          {createMutation.isPending ? "Guardando…" : "Guardar borrador"}
        </Button>
      </div>

      <Dialog open={openCat !== null} onOpenChange={(o) => !o && setOpenCat(null)}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          {openCat ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: CATEGORIA_BY_KEY[openCat].color }}
                  />
                  {CATEGORIA_BY_KEY[openCat].icon} {CATEGORIA_BY_KEY[openCat].label}
                </DialogTitle>
                <DialogDescription className="rounded-md bg-indigo-50 p-3 text-xs text-indigo-900">
                  {CATEGORIA_BY_KEY[openCat].note}
                </DialogDescription>
              </DialogHeader>

              {openCat === "mov" ? (
                <ModalMovimiento ref={movRef} sedeTipo={sedeTipo} sedeNombre={sedeQ.data?.establishmentName ?? null} />
              ) : null}
              {openCat === "dieta" ? <ModalDieta ref={dietaRef} /> : null}
              {openCat === "cuidados" ? <ModalCuidados ref={cuidadosRef} /> : null}
              {openCat === "med" ? <ModalMedicamento ref={medRef} /> : null}
              {openCat === "lab" ? <ModalLaboratorio ref={labRef} /> : null}
              {openCat === "gab" ? <ModalGabinete ref={gabRef} /> : null}
              {openCat === "proc" ? <ModalProcedimiento ref={procRef} /> : null}
              {openCat === "inter" ? <ModalInterconsulta ref={interRef} /> : null}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpenCat(null)}>
                  Cancelar
                </Button>
                <Button type="button" onClick={handleAgregarDesdeModal} data-testid="btn-agregar-al-cuadro">
                  + Agregar
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {toast ? (
        <Toast variant={toast.variant ?? "default"} open onOpenChange={(o) => !o && setToast(null)}>
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </div>
  );
}
