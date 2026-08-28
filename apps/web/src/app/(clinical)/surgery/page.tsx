"use client";

/**
 * §13 Surgery — Listado de casos quirúrgicos.
 */
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";
import { SurgeryCaseCard } from "@/components/surgery/surgery-case-card";

type SurgeryStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "POSTPONED";

const STATUS_OPTIONS: { value: SurgeryStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "SCHEDULED", label: "Programado" },
  { value: "CONFIRMED", label: "Confirmado" },
  { value: "IN_PROGRESS", label: "En curso" },
  { value: "COMPLETED", label: "Completado" },
  { value: "CANCELLED", label: "Cancelado" },
  { value: "POSTPONED", label: "Pospuesto" },
];

export default function SurgeryListPage() {
  const [status, setStatus] = React.useState<SurgeryStatus | "ALL">("ALL");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (status !== "ALL") input.status = status;
    return input;
  }, [status]);

  const query = trpc.surgery.case.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Cirugía</h1>
          <p className="text-sm text-muted-foreground">
            Casos quirúrgicos programados y atendidos (§13).
          </p>
        </div>
        <Button asChild>
          <Link href="/surgery/new">Programar cirugía</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-status">Estado</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as SurgeryStatus | "ALL")}
              >
                <SelectTrigger id="filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Casos</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin casos para los filtros.</p>
          )}
          {query.data && query.data.length > 0 && (
            <div className="space-y-2">
              {query.data.map((c) => (
                <SurgeryCaseCard key={c.id} surgeryCase={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
