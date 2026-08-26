"use client";

/**
 * CC-0026 Ola 2 — categoría "Movimiento de paciente" (ESP-MOCKUP-0026 §mov).
 * Cascada sede → tipo de movimiento → submenús con el catálogo real de las 3
 * sedes de Avante. La sede NO se pide: se resuelve del establecimiento activo
 * de la sesión (`trpc.eceIndicaciones.contextoSede`).
 */
import * as React from "react";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Input } from "@his/ui/components/input";
import {
  MOV_INGRESO,
  MOV_PASE,
  MOV_REMISION,
  MOV_TIPOS,
  SEDES,
  TRAS_CM_ROOMS,
  TRAS_HE,
  type SedeTipo,
} from "./movimiento-catalogo";

export interface ModalMovimientoHandle {
  compose: () => { descripcion: string; detalle: Record<string, unknown> } | null;
}

export const ModalMovimiento = React.forwardRef<
  ModalMovimientoHandle,
  { sedeTipo: SedeTipo; sedeNombre: string | null }
>(function ModalMovimiento({ sedeTipo, sedeNombre }, ref) {
  const tipos = MOV_TIPOS[sedeTipo];
  const [tipoMov, setTipoMov] = React.useState(tipos[0]!);
  const [servicioIngreso, setServicioIngreso] = React.useState(MOV_INGRESO[sedeTipo]?.[0] ?? "");
  const [unidadPase, setUnidadPase] = React.useState(MOV_PASE[sedeTipo].opts[0]!);
  const pisos = Object.keys(TRAS_HE);
  const [piso, setPiso] = React.useState(pisos[0]!);
  const serviciosDePiso = Object.keys(TRAS_HE[piso] ?? {});
  const [servicioTraslado, setServicioTraslado] = React.useState(serviciosDePiso[0] ?? "");
  const habitacionesDeServicio = TRAS_HE[piso]?.[servicioTraslado] ?? [];
  const [habitacion, setHabitacion] = React.useState(habitacionesDeServicio[0] ?? "");
  const [servicioCm] = React.useState("Hospitalización adultos");
  const [habitacionCm, setHabitacionCm] = React.useState(TRAS_CM_ROOMS[0]!);
  const sedesDestino = Object.keys(SEDES).filter((s) => s !== sedeNombre);
  const [sedeDestino, setSedeDestino] = React.useState(sedesDestino[0] ?? "");
  const [institucion, setInstitucion] = React.useState(MOV_REMISION[0]!);
  const [centroEspecifico, setCentroEspecifico] = React.useState("");
  const [obs, setObs] = React.useState("");

  React.useEffect(() => {
    const nuevos = Object.keys(TRAS_HE[piso] ?? {});
    setServicioTraslado((prev) => (nuevos.includes(prev) ? prev : (nuevos[0] ?? "")));
  }, [piso]);
  React.useEffect(() => {
    const nuevas = TRAS_HE[piso]?.[servicioTraslado] ?? [];
    setHabitacion((prev) => (nuevas.includes(prev) ? prev : (nuevas[0] ?? "")));
  }, [piso, servicioTraslado]);

  React.useImperativeHandle(ref, () => ({
    compose: () => {
      let destino: Record<string, unknown> = {};
      let destinoTexto = "";
      switch (tipoMov) {
        case "Ingreso a":
          destino = { servicioClinico: servicioIngreso };
          destinoTexto = servicioIngreso;
          break;
        case "Pase a":
          destino = { unidadOSala: unidadPase };
          destinoTexto = unidadPase;
          break;
        case "Traslado a":
          if (sedeTipo === "HE") {
            destino = { piso, servicioClinico: servicioTraslado, habitacion };
            destinoTexto = `${piso} · ${servicioTraslado} · ${habitacion}`;
          } else {
            destino = { servicioClinico: servicioCm, habitacion: habitacionCm };
            destinoTexto = `${servicioCm} · ${habitacionCm}`;
          }
          break;
        case "Referencia a":
          destino = { sedeDestino };
          destinoTexto = sedeDestino;
          break;
        case "Remisión a":
          destino = { institucion, centroEspecifico: centroEspecifico.trim() || undefined };
          destinoTexto = centroEspecifico.trim()
            ? `${institucion} — ${centroEspecifico.trim()}`
            : institucion;
          break;
      }
      const descripcion =
        `${tipoMov} ${destinoTexto}`.trim() + (obs.trim() ? ` · Obs: ${obs.trim()}` : "");
      return {
        descripcion,
        detalle: { tipoMovimiento: tipoMov, sede: sedeNombre, ...destino, observaciones: obs.trim() || undefined },
      };
    },
  }));

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
        La sede del establecimiento se sobreentiende desde el módulo de admisión:{" "}
        <strong>{sedeNombre ?? "sin establecimiento activo"}</strong>. El tipo de movimiento es
        la primera orden y define los menús siguientes según la sede.
      </p>

      <div className="space-y-1">
        <Label htmlFor="mov-tipo">Tipo de movimiento</Label>
        <Select value={tipoMov} onValueChange={setTipoMov}>
          <SelectTrigger id="mov-tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tipos.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tipoMov === "Ingreso a" ? (
        <div className="space-y-1">
          <Label htmlFor="mov-ingreso">Servicio clínico</Label>
          <Select value={servicioIngreso} onValueChange={setServicioIngreso}>
            <SelectTrigger id="mov-ingreso">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(MOV_INGRESO[sedeTipo] ?? []).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {tipoMov === "Pase a" ? (
        <div className="space-y-1">
          <Label htmlFor="mov-pase">{MOV_PASE[sedeTipo].label}</Label>
          <Select value={unidadPase} onValueChange={setUnidadPase}>
            <SelectTrigger id="mov-pase">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOV_PASE[sedeTipo].opts.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {tipoMov === "Traslado a" && sedeTipo === "HE" ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="mov-piso">Piso</Label>
            <Select value={piso} onValueChange={setPiso}>
              <SelectTrigger id="mov-piso">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pisos.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mov-svc">Servicio clínico</Label>
            <Select value={servicioTraslado} onValueChange={setServicioTraslado}>
              <SelectTrigger id="mov-svc">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {serviciosDePiso.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mov-hab">Habitación</Label>
            <Select value={habitacion} onValueChange={setHabitacion}>
              <SelectTrigger id="mov-hab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {habitacionesDeServicio.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {tipoMov === "Traslado a" && sedeTipo !== "HE" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Servicio clínico</Label>
            <Input value={servicioCm} disabled readOnly />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mov-hab-cm">Habitación</Label>
            <Select value={habitacionCm} onValueChange={setHabitacionCm}>
              <SelectTrigger id="mov-hab-cm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRAS_CM_ROOMS.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {tipoMov === "Referencia a" ? (
        <div className="space-y-1">
          <Label htmlFor="mov-ref">Sede de destino</Label>
          <Select value={sedeDestino} onValueChange={setSedeDestino}>
            <SelectTrigger id="mov-ref">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sedesDestino.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {tipoMov === "Remisión a" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="mov-inst">Institución</Label>
            <Select value={institucion} onValueChange={setInstitucion}>
              <SelectTrigger id="mov-inst">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOV_REMISION.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mov-centro">Especificar centro</Label>
            <Input
              id="mov-centro"
              value={centroEspecifico}
              onChange={(e) => setCentroEspecifico(e.target.value)}
              placeholder="Nombre del centro de salud…"
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="mov-obs">Observaciones (opcional)</Label>
        <Textarea
          id="mov-obs"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Motivo, condición del paciente, detalles del movimiento…"
        />
      </div>
    </div>
  );
});
