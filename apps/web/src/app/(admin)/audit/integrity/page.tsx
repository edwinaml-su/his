"use client";

/**
 * US-2.8 — Vista de integridad del Audit Log.
 *
 * Permite al admin pulsar "Verificar ahora" → ejecuta `auditIntegrity.verifyChain`
 * en el servidor (que llama a la función SQL `audit.fn_verify_chain`).
 *
 * UX:
 *  - Cabecera con stats (total filas, último id, hash de cabeza de cadena).
 *  - Botón "Verificar ahora" → loading → resultado.
 *  - Resultado verde si la cadena está íntegra, rojo si hay rupturas (lista los
 *    IDs problemáticos con expected vs actual hash).
 *  - Histórico ligero de las últimas verificaciones de la sesión (cliente only).
 *
 * El router tRPC `auditIntegrity` se cablea en `_app.ts` (cuando @Orq lo
 * agregue); por ahora accedemos via `(trpc as any).auditIntegrity.*` siguiendo
 * la convención del repo (idéntico a userAdmin/rbac antes de su wiring).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

interface VerifyRunRecord {
  at: Date;
  ok: boolean;
  totalRows: number;
  brokenCount: number;
  fromId: number;
}

interface ChainBreakDTO {
  id: string;
  expectedHash: string;
  actualHash: string | null;
}

interface VerifyChainResultDTO {
  ok: boolean;
  totalRows: number;
  fromId: number;
  breaks: ChainBreakDTO[];
  lastVerifiedAt: Date;
}

interface ChainStatsDTO {
  totalRows: number;
  lastId: string | null;
  lastHash: string | null;
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export default function AuditIntegrityPage() {
  const [history, setHistory] = React.useState<VerifyRunRecord[]>([]);
  const [lastResult, setLastResult] = React.useState<VerifyChainResultDTO | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stats = (trpc as any).auditIntegrity.chainStats.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const utils = trpc.useUtils();

  const [pending, setPending] = React.useState(false);

  // verifyChain está modelado como query (no muta nada). Para correr "on
  // demand" sin caching molesto usamos fetch imperativo vía utils.
  const runVerify = React.useCallback(async () => {
    setPending(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await (utils as any).auditIntegrity.verifyChain.fetch({
        fromId: 0,
      })) as VerifyChainResultDTO;
      setLastResult(result);
      setHistory((h) =>
        [
          {
            at: new Date(),
            ok: result.ok,
            totalRows: result.totalRows,
            brokenCount: result.breaks.length,
            fromId: result.fromId,
          },
          ...h,
        ].slice(0, 10),
      );
      // refrescar stats por si la última inserción cambió.
      stats.refetch();
    } finally {
      setPending(false);
    }
  }, [utils, stats]);

  const statsData = stats.data as ChainStatsDTO | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Integridad del Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            US-2.8 — verificación de la cadena hash append-only (TDR §6.3).
            Ejecuta `audit.fn_verify_chain` para detectar manipulaciones
            forzadas a nivel de base de datos.
          </p>
        </div>
        <Button onClick={runVerify} disabled={pending}>
          {pending ? "Verificando…" : "Verificar ahora"}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Filas totales</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xl">
              {statsData ? statsData.totalRows.toLocaleString("es-SV") : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Último id</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xl">{statsData?.lastId ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Hash de cabeza</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className="font-mono text-sm"
              title={statsData?.lastHash ?? undefined}
            >
              {shortHash(statsData?.lastHash)}
            </p>
          </CardContent>
        </Card>
      </div>

      {lastResult ? (
        lastResult.ok ? (
          <Alert>
            <AlertTitle>Cadena íntegra</AlertTitle>
            <AlertDescription>
              {lastResult.totalRows.toLocaleString("es-SV")} filas verificadas.
              Sin rupturas detectadas.{" "}
              <span className="text-xs text-muted-foreground">
                ({new Date(lastResult.lastVerifiedAt).toLocaleString("es-SV")})
              </span>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>
              {lastResult.breaks.length} registro(s) con hash inválido
            </AlertTitle>
            <AlertDescription>
              IDs comprometidos:{" "}
              <span className="font-mono">
                {lastResult.breaks
                  .slice(0, 8)
                  .map((b) => b.id)
                  .join(", ")}
                {lastResult.breaks.length > 8 ? "…" : ""}
              </span>
            </AlertDescription>
          </Alert>
        )
      ) : null}

      {lastResult && lastResult.breaks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Detalle de rupturas</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">ID</TableHead>
                  <TableHead>Hash esperado (recalculado)</TableHead>
                  <TableHead>Hash actual (en BD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lastResult.breaks.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.id}</TableCell>
                    <TableCell
                      className="font-mono text-xs"
                      title={b.expectedHash}
                    >
                      {shortHash(b.expectedHash)}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs"
                      title={b.actualHash ?? undefined}
                    >
                      {shortHash(b.actualHash)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Verificaciones recientes (sesión)</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no se ha ejecutado ninguna verificación en esta sesión.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha/hora</TableHead>
                  <TableHead>Filas verificadas</TableHead>
                  <TableHead>desde id</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">
                      {h.at.toLocaleString("es-SV")}
                    </TableCell>
                    <TableCell>{h.totalRows.toLocaleString("es-SV")}</TableCell>
                    <TableCell className="font-mono text-xs">{h.fromId}</TableCell>
                    <TableCell>
                      {h.ok ? (
                        <Badge variant="success">OK</Badge>
                      ) : (
                        <Badge variant="destructive">{h.brokenCount} rotas</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
