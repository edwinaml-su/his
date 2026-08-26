"use client";

/**
 * CC-0026 Ola 2 — categoría "Medicamentos" (ESP-MOCKUP-0026 §med).
 *
 * Búsqueda sobre el catálogo REAL `Drug` del HIS vía `trpc.pharmacy.drug.list`
 * (NO el MED_DATA embebido del mockup — directiva explícita del REQ).
 *
 * P.U./cargo: el mockup muestra P.U.×cantidad=total contra la cuenta. El
 * motor de reglas de precios (CC-0021, `resolverPorCuenta`) exige `cuentaId`
 * (PatientAccount) + códigos de servicio — esta pantalla solo conoce
 * `episodioId`, sin cuenta resuelta ni mapeo Drug→código de servicio. Cerrar
 * esa integración es trabajo de facturación fuera de alcance de esta ola
 * (directiva explícita del REQ) — se deja el placeholder abajo.
 */
import * as React from "react";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Textarea } from "@his/ui/components/textarea";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

const UNIDADES_DOSIS = [
  "mg",
  "g",
  "mcg",
  "UI",
  "mEq",
  "ml",
  "tableta(s)",
  "cápsula(s)",
  "gota(s)",
  "puff",
  "ampolla",
];

/** label mostrado (idéntico al mockup) → valor de `viaAdminEnum` (router). */
const VIAS_MED: Array<{ label: string; backend?: string }> = [
  { label: "VO", backend: "ORAL" },
  { label: "IV", backend: "IV" },
  { label: "IM", backend: "IM" },
  { label: "SC", backend: "SC" },
  { label: "SL", backend: "SUBLINGUAL" },
  { label: "Inhalada", backend: "INHALED" },
  { label: "Tópica", backend: "TOPICAL" },
  { label: "Oftálmica", backend: "OPHTHALMIC" },
  { label: "Ótica", backend: "OTIC" },
  { label: "Nasal", backend: "NASAL" },
  { label: "Rectal", backend: "RECTAL" },
  // Sin equivalente en viaAdminEnum del router (desviación declarada en el
  // reporte de la Ola 2) — se guarda en descripcion/detalle, no en `via`.
  { label: "Vaginal", backend: undefined },
];

/** label mostrado → valor de `frecuenciaEnum` (router). Ver nota de desviación arriba. */
const FRECUENCIAS_MED: Array<{ label: string; backend?: string }> = [
  { label: "STAT (inmediato)", backend: "STAT" },
  { label: "Dosis única", backend: undefined },
  { label: "c/4h", backend: "Q4H" },
  { label: "c/6h", backend: "Q6H" },
  { label: "c/8h", backend: "Q8H" },
  { label: "c/12h", backend: "Q12H" },
  { label: "c/24h", backend: "Q24H" },
  { label: "Infusión continua", backend: undefined },
  { label: "PRN", backend: "PRN" },
];

interface DrugHit {
  id: string;
  genericName: string;
  brandName: string | null;
  strengthValue: unknown;
  strengthUnit: string;
  pharmaceuticalForm: string;
  alertLevel: string;
}

export interface ModalMedicamentoHandle {
  compose: () => {
    descripcion: string;
    detalle: Record<string, unknown>;
    drugId?: string;
    dosis?: string;
    via?: string;
    frecuencia?: string;
    duracion?: string;
  } | null;
}

export const ModalMedicamento = React.forwardRef<ModalMedicamentoHandle, Record<never, never>>(
  function ModalMedicamento(_props, ref) {
    const [busqueda, setBusqueda] = React.useState("");
    const [debounced, setDebounced] = React.useState("");
    const [seleccionado, setSeleccionado] = React.useState<DrugHit | null>(null);
    const [dosisValor, setDosisValor] = React.useState("");
    const [unidad, setUnidad] = React.useState(UNIDADES_DOSIS[0]!);
    const [via, setVia] = React.useState(VIAS_MED[0]!.label);
    const [frecuencia, setFrecuencia] = React.useState(FRECUENCIAS_MED[0]!.label);
    const [duracion, setDuracion] = React.useState("");
    const [cantidad, setCantidad] = React.useState(1);
    const [obs, setObs] = React.useState("");

    React.useEffect(() => {
      const t = setTimeout(() => setDebounced(busqueda.trim()), 300);
      return () => clearTimeout(t);
    }, [busqueda]);

    const searchQ = trpc.pharmacy.drug.list.useQuery(
      { search: debounced, limit: 8 },
      { enabled: debounced.length >= 3 },
    );
    const hits = (searchQ.data ?? []) as DrugHit[];

    React.useImperativeHandle(ref, () => ({
      compose: () => {
        if (!seleccionado) return null;
        const viaSel = VIAS_MED.find((v) => v.label === via);
        const frecSel = FRECUENCIAS_MED.find((f) => f.label === frecuencia);
        const nombre = seleccionado.brandName || seleccionado.genericName;
        const dosisTexto = dosisValor.trim() ? `${dosisValor.trim()} ${unidad}` : undefined;
        const parts = [nombre];
        if (dosisTexto) parts.push(dosisTexto);
        parts.push(via);
        parts.push(frecuencia);
        if (duracion.trim()) parts.push(duracion.trim());
        parts.push(`cantidad a cargar ${cantidad} · P.U. pendiente de resolver de precios (CC-0021)`);
        if (obs.trim()) parts.push(`Obs: ${obs.trim()}`);
        return {
          descripcion: parts.join(" · "),
          detalle: {
            drugId: seleccionado.id,
            nombre,
            genericName: seleccionado.genericName,
            dosisValor: dosisValor.trim() || undefined,
            dosisUnidad: unidad,
            via,
            frecuencia,
            duracion: duracion.trim() || undefined,
            cantidad,
            precioUnitario: null,
            precioNota: "pendiente de resolver de precios (CC-0021)",
            observaciones: obs.trim() || undefined,
          },
          drugId: seleccionado.id,
          dosis: dosisTexto,
          via: viaSel?.backend,
          frecuencia: frecSel?.backend,
          duracion: duracion.trim() || undefined,
        };
      },
    }));

    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="med-busca">Agregar: buscar producto (3+ letras)</Label>
          <Input
            id="med-busca"
            autoComplete="off"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="esome…"
            data-testid="med-search"
          />
        </div>

        {debounced.length >= 3 && !seleccionado ? (
          <ul className="max-h-48 divide-y overflow-y-auto rounded-md border" data-testid="med-results">
            {searchQ.isLoading ? (
              <li className="p-2 text-xs text-muted-foreground">Buscando…</li>
            ) : hits.length === 0 ? (
              <li className="p-2 text-xs text-muted-foreground">
                Sin coincidencias en el catálogo de medicamentos.
              </li>
            ) : (
              hits.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setSeleccionado(m);
                      setBusqueda("");
                    }}
                  >
                    <span>
                      {m.brandName || m.genericName}{" "}
                      {m.alertLevel !== "standard" ? (
                        <Badge variant="warning" className="ml-1 align-middle">
                          {m.alertLevel}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {String(m.strengthValue)} {m.strengthUnit}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}

        {seleccionado ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
            <div>
              <strong>{seleccionado.brandName || seleccionado.genericName}</strong>
              <div className="text-xs text-muted-foreground">
                DCI: {seleccionado.genericName} · {String(seleccionado.strengthValue)}{" "}
                {seleccionado.strengthUnit} · {seleccionado.pharmaceuticalForm}
              </div>
            </div>
            <button
              type="button"
              className="text-xs text-destructive"
              onClick={() => setSeleccionado(null)}
            >
              ✕ cambiar
            </button>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="med-dosis">Dosis (cantidad)</Label>
            <Input
              id="med-dosis"
              value={dosisValor}
              onChange={(e) => setDosisValor(e.target.value)}
              placeholder="40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="med-unidad">Unidad</Label>
            <Select value={unidad} onValueChange={setUnidad}>
              <SelectTrigger id="med-unidad">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIDADES_DOSIS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="med-via">Vía (restringida al registro)</Label>
            <Select value={via} onValueChange={setVia}>
              <SelectTrigger id="med-via">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIAS_MED.map((v) => (
                  <SelectItem key={v.label} value={v.label}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="med-frec">Frecuencia</Label>
            <Select value={frecuencia} onValueChange={setFrecuencia}>
              <SelectTrigger id="med-frec">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FRECUENCIAS_MED.map((f) => (
                  <SelectItem key={f.label} value={f.label}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="med-dur">Duración (opcional)</Label>
            <Input
              id="med-dur"
              value={duracion}
              onChange={(e) => setDuracion(e.target.value)}
              placeholder="7 días / 24 horas / hasta nueva orden"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="med-qty">Cantidad a cargar</Label>
            <Input
              id="med-qty"
              type="number"
              min={1}
              step={1}
              value={cantidad}
              onChange={(e) => setCantidad(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
          </div>
          <div className="space-y-1">
            <Label>P.U. × cantidad = Total (rubro)</Label>
            <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
              P.U. pendiente de resolver de precios (CC-0021)
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="med-obs">Observaciones (opcional)</Label>
          <Textarea id="med-obs" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="pasar en 30 min…" />
        </div>
      </div>
    );
  },
);
