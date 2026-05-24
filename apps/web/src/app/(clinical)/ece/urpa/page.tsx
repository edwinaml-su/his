"use client";

/**
 * ECE — URPA: Unidad de Recuperación Post-Anestésica
 *
 * Lista pacientes activos en URPA con puntaje Aldrete y tiempo en unidad.
 * Conectado al router eceUrpaRecovery.list vía tRPC.
 *
 * Roles habilitados: NURSE, PHYSICIAN.
 */

import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { AldreteBadge } from "@/components/urpa/aldrete-badge";
import { UrpaCountdown } from "@/components/urpa/urpa-countdown";
import { trpc } from "@/lib/trpc/react";

export default function UrpaPage() {
  const query = trpc.eceUrpa.list.useQuery({
    estadoRegistro: "activo",
    limit: 50,
  });

  const activos = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            URPA — Recuperación Post-Anestésica
          </h1>
          <p className="text-sm text-muted-foreground">
            Pacientes activos en la unidad · ECE
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/urpa/nuevo">Registrar ingreso</Link>
        </Button>
      </div>

      {/* Estados de carga / error */}
      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Cargando pacientes…</p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}

      {/* Tabla de pacientes activos */}
      {!query.isLoading && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table
            className="w-full text-sm"
            aria-label="Pacientes activos en URPA"
          >
            <caption className="sr-only">
              Lista de pacientes en recuperación post-anestésica, con puntaje
              Aldrete y tiempo transcurrido en la unidad.
            </caption>
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-3 py-2.5">Acto quirúrgico</th>
                <th scope="col" className="px-3 py-2.5">Aldrete ingreso</th>
                <th scope="col" className="px-3 py-2.5">Tiempo en URPA</th>
                <th scope="col" className="px-3 py-2.5">Estado</th>
                <th scope="col" className="px-3 py-2.5 sr-only">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {activos.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-muted-foreground"
                  >
                    No hay pacientes activos en URPA.
                  </td>
                </tr>
              ) : (
                activos.map((row) => (
                  <tr key={row.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {row.acto_quirurgico_id.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2.5">
                      <AldreteBadge score={row.escala_aldrete_ingreso} />
                    </td>
                    <td className="px-3 py-2.5">
                      <UrpaCountdown ingresoTs={new Date(row.ingreso_urpa_ts).toISOString()} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                        Activo
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/ece/urpa/${row.id}`}
                        className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
