"use client";

/**
 * RondaClient — orquestador del Modo Rondas (US.F2.6.46, 50, 51).
 *
 * Estados posibles:
 *  IDLE    → sin sesión activa; muestra selector de modo + botón Iniciar
 *  ACTIVE  → sesión activa; muestra progreso + lista indicaciones
 *  PAUSED  → sesión pausada; muestra botón Reanudar
 *  DONE    → sesión completada; muestra resumen
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/react";
import { RondaProgress } from "./ronda-progress";
import { RondaToolbar } from "./ronda-toolbar";
import { IndicacionCard } from "./indicacion-card";
import { ConfirmPauseDialog } from "./confirm-pause-dialog";

type Modo = "POR_HORA" | "POR_UBICACION";

export function RondaClient() {
  const [modo, setModo] = useState<Modo>("POR_HORA");
  const [showPauseDialog, setShowPauseDialog] = useState(false);

  const utils = trpc.useUtils();

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: currentData, isLoading: loadingCurrent } =
    trpc.bedsideRonda.current.useQuery(undefined, {
      refetchInterval: 30_000,
    });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const startMut = trpc.bedsideRonda.start.useMutation({
    onSuccess: () => void utils.bedsideRonda.current.invalidate(),
  });
  const pauseMut = trpc.bedsideRonda.pause.useMutation({
    onSuccess: () => {
      setShowPauseDialog(false);
      void utils.bedsideRonda.current.invalidate();
    },
  });
  const resumeMut = trpc.bedsideRonda.resume.useMutation({
    onSuccess: () => void utils.bedsideRonda.current.invalidate(),
  });
  const nextMut = trpc.bedsideRonda.nextIndication.useMutation({
    onSuccess: () => void utils.bedsideRonda.current.invalidate(),
  });
  const completeMut = trpc.bedsideRonda.complete.useMutation({
    onSuccess: () => void utils.bedsideRonda.current.invalidate(),
  });

  const mutLoading =
    startMut.isPending ||
    pauseMut.isPending ||
    resumeMut.isPending ||
    nextMut.isPending ||
    completeMut.isPending;

  // ── Render: cargando ──────────────────────────────────────────────────────
  if (loadingCurrent) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
    );
  }

  const session = currentData?.session ?? null;

  // ── Render: sin sesión activa ─────────────────────────────────────────────
  if (!session) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Iniciar nueva ronda</h2>

        {/* Toggle modo orden */}
        <div className="mb-6">
          <p className="mb-2 text-sm font-medium text-gray-700">Orden de ronda</p>
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              onClick={() => setModo("POR_HORA")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                modo === "POR_HORA"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Por hora
            </button>
            <button
              onClick={() => setModo("POR_UBICACION")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                modo === "POR_UBICACION"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Por ubicacion
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            {modo === "POR_HORA"
              ? "Las indicaciones se ordenan por hora programada de administracion."
              : "Las camas se ordenan por servicio y numero de cama para minimizar desplazamientos."}
          </p>
        </div>

        {startMut.error && (
          <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">
            {startMut.error.message}
          </p>
        )}

        <button
          onClick={() => startMut.mutate({ modo })}
          disabled={mutLoading}
          className="w-full rounded-xl bg-blue-600 py-3 text-base font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {startMut.isPending ? "Iniciando..." : "Iniciar ronda"}
        </button>
      </div>
    );
  }

  // ── Render: ronda completada ──────────────────────────────────────────────
  if (session.completadoEn) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-lg font-bold text-green-700">Ronda completada</p>
        <p className="mt-1 text-sm text-gray-600">
          {session.indicacionesCompletadas.length} de {session.totalPacientes} pacientes
          administrados.
        </p>
        <button
          onClick={() => startMut.mutate({ modo })}
          disabled={mutLoading}
          className="mt-4 rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Nueva ronda
        </button>
      </div>
    );
  }

  const pausada = !!session.pausadoEn;
  const pending = session.indicacionesPending;
  const completadas = session.indicacionesCompletadas;
  const nextIndicacion = pending[0] ?? null;

  // ── Render: sesión activa / pausada ──────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Progreso */}
      <RondaProgress
        completados={completadas.length}
        total={session.totalPacientes}
        iniciadoEn={session.iniciadoEn}
        pausadoEn={session.pausadoEn}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium">Orden:</span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {session.modo === "POR_HORA" ? "Por hora" : "Por ubicacion"}
          </span>
          {pausada && (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              PAUSADA
            </span>
          )}
        </div>
        <RondaToolbar
          pausada={pausada}
          loading={mutLoading}
          onPausar={() => setShowPauseDialog(true)}
          onReanudar={() => resumeMut.mutate({ sessionId: session.id })}
          onAbandonar={() => completeMut.mutate({ sessionId: session.id })}
        />
      </div>

      {/* Error de mutación */}
      {(nextMut.error ?? pauseMut.error ?? resumeMut.error) && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">
          {(nextMut.error ?? pauseMut.error ?? resumeMut.error)?.message}
        </p>
      )}

      {/* Lista indicaciones */}
      {pausada ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="font-semibold text-amber-700">Ronda pausada</p>
          <p className="mt-1 text-sm text-gray-600">
            {pending.length} indicaciones pendientes. Reanude para continuar.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Siguiente indicacion destacada */}
          {nextIndicacion && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Siguiente paciente
              </p>
              <IndicacionCard
                indicacion={nextIndicacion}
                isNext={true}
                loading={mutLoading}
                onNext={(id) =>
                  nextMut.mutate({ sessionId: session.id, indicacionId: id })
                }
              />
            </div>
          )}

          {/* Cola restante */}
          {pending.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Cola ({pending.length - 1} restantes)
              </p>
              <div className="flex flex-col gap-2">
                {pending.slice(1).map((ind) => (
                  <IndicacionCard
                    key={ind.indicacionId}
                    indicacion={ind}
                    isNext={false}
                    loading={mutLoading}
                    onNext={(id) =>
                      nextMut.mutate({ sessionId: session.id, indicacionId: id })
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Sin pendientes */}
          {pending.length === 0 && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
              <p className="font-semibold text-green-700">Todas las indicaciones completadas</p>
            </div>
          )}
        </div>
      )}

      {/* Dialog confirmacion pausa */}
      <ConfirmPauseDialog
        open={showPauseDialog}
        loading={pauseMut.isPending}
        onConfirm={() => pauseMut.mutate({ sessionId: session.id })}
        onCancel={() => setShowPauseDialog(false)}
      />
    </div>
  );
}
