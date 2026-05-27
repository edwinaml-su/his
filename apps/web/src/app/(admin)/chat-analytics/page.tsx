"use client";

/**
 * /admin/chat-analytics — Telemetría del Avante Asistente (Fase 4).
 *
 * Cards de resumen + top preguntas + uso por rol + últimas sesiones.
 * Selector de rango (7/30/90 días). Acceso: ADMIN o DIR.
 */
import * as React from "react";
import { Sparkles, TrendingUp, DollarSign, ThumbsUp, ThumbsDown, Users, Wrench, BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";

export default function ChatAnalyticsPage() {
  const [days, setDays] = React.useState<7 | 30 | 90>(30);

  const summary = trpc.chatAnalytics.summary.useQuery({ days });
  const topQueries = trpc.chatAnalytics.topQueries.useQuery({ days, limit: 20 });
  const byRole = trpc.chatAnalytics.byRole.useQuery({ days });
  const recent = trpc.chatAnalytics.recentSessions.useQuery({ limit: 30 });

  function formatCurrency(n: number): string {
    return new Intl.NumberFormat("es-SV", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
  }

  function formatRelative(iso: string): string {
    const date = new Date(iso);
    const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return "ahora";
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-primary" aria-hidden />
            Avante Asistente — Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Telemetría de uso del chatbot. Permite identificar preguntas frecuentes,
            errores y oportunidades para mejorar el prompt y los flujos.
          </p>
        </div>
        <div>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as 7 | 30 | 90)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 días</SelectItem>
              <SelectItem value="30">Últimos 30 días</SelectItem>
              <SelectItem value="90">Últimos 90 días</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Cards resumen */}
      {summary.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {summary.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {summary.error.message}
        </p>
      )}
      {summary.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Sesiones" value={summary.data.totalSessions} icon={<Sparkles className="h-4 w-4" aria-hidden />} />
          <Stat label="Mensajes" value={summary.data.totalMessages} />
          <Stat label="Usuarios activos" value={summary.data.activeUsers} icon={<Users className="h-4 w-4" aria-hidden />} />
          <Stat label="Tool calls" value={summary.data.totalToolCalls} icon={<Wrench className="h-4 w-4" aria-hidden />} />
          <Stat label="RAG hits" value={summary.data.totalRagHits} icon={<BookOpen className="h-4 w-4" aria-hidden />} />
          <Stat label="Tokens in" value={summary.data.totalTokensIn.toLocaleString("es-SV")} />
          <Stat label="Tokens out" value={summary.data.totalTokensOut.toLocaleString("es-SV")} />
          <Stat
            label="Costo estimado"
            value={formatCurrency(summary.data.estimatedCostUsd)}
            icon={<DollarSign className="h-4 w-4" aria-hidden />}
          />
          <Stat
            label="👍 Satisfacción"
            value={
              summary.data.csatPercent !== null
                ? `${summary.data.csatPercent}%`
                : "—"
            }
            sub={`${summary.data.thumbsUp} 👍 · ${summary.data.thumbsDown} 👎`}
            icon={<TrendingUp className="h-4 w-4" aria-hidden />}
            accent={
              summary.data.csatPercent !== null && summary.data.csatPercent >= 70
                ? "good"
                : summary.data.csatPercent !== null && summary.data.csatPercent < 50
                ? "bad"
                : undefined
            }
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="queries">
        <TabsList>
          <TabsTrigger value="queries">Top preguntas</TabsTrigger>
          <TabsTrigger value="roles">Uso por rol</TabsTrigger>
          <TabsTrigger value="sessions">Últimas sesiones</TabsTrigger>
        </TabsList>

        <TabsContent value="queries" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top preguntas de usuarios</CardTitle>
            </CardHeader>
            <CardContent>
              {topQueries.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
              {topQueries.data && topQueries.data.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Aún no hay preguntas registradas. Empieza a usar el asistente.
                </p>
              )}
              {topQueries.data && topQueries.data.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pregunta (truncada a 100 chars)</TableHead>
                      <TableHead className="w-20 text-right">Veces</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topQueries.data.map((q, i) => (
                      <TableRow key={`${q.content}-${i}`}>
                        <TableCell className="text-sm">{q.content}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{q.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Uso por rol</CardTitle>
            </CardHeader>
            <CardContent>
              {byRole.data && byRole.data.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">Sin datos.</p>
              )}
              {byRole.data && byRole.data.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rol</TableHead>
                      <TableHead className="text-right w-24">Sesiones</TableHead>
                      <TableHead className="text-right w-24">Mensajes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byRole.data.map((r) => (
                      <TableRow key={r.roleCode}>
                        <TableCell><Badge variant="secondary">{r.roleCode}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{r.sessions}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.messages}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="mt-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Últimas conversaciones</CardTitle>
            </CardHeader>
            <CardContent>
              {recent.data && recent.data.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">Sin sesiones aún.</p>
              )}
              {recent.data && recent.data.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pregunta inicial</TableHead>
                      <TableHead className="w-32">Roles</TableHead>
                      <TableHead className="w-20 text-center">Msg</TableHead>
                      <TableHead className="w-20 text-center">Tools</TableHead>
                      <TableHead className="w-24 text-center">Feedback</TableHead>
                      <TableHead className="w-20 text-right">Hace</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.data.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm max-w-md truncate">
                          {s.firstUserMsg ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {s.userRoleCodes.slice(0, 2).map((r) => (
                              <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                            ))}
                            {s.userRoleCodes.length > 2 && (
                              <span className="text-[10px] text-muted-foreground">+{s.userRoleCodes.length - 2}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{s.messageCount}</TableCell>
                        <TableCell className="text-center tabular-nums">{s.totalToolCalls || "—"}</TableCell>
                        <TableCell className="text-center">
                          {s.userFeedback === 1 ? (
                            <ThumbsUp className="inline h-4 w-4 text-green-600" aria-label="Útil" />
                          ) : s.userFeedback === -1 ? (
                            <ThumbsDown className="inline h-4 w-4 text-red-600" aria-label="No útil" />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                          {formatRelative(s.lastMessageAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  accent?: "good" | "bad";
}

function Stat({ label, value, sub, icon, accent }: StatProps) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p
        className={`text-2xl font-bold tabular-nums ${
          accent === "good"
            ? "text-green-700"
            : accent === "bad"
              ? "text-red-700"
              : ""
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
