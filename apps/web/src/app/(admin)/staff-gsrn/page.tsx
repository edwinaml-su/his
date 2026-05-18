"use client";

/**
 * US.F2.6.2 — Catálogo GSRN Profesionales (badge institucional).
 *
 * Admin clínico gestiona GSRN del personal (médicos, enfermería,
 * farmacéuticos) con badge DataMatrix. Filtros por rol y status.
 *
 * RBAC: Solo ADMIN_CLINICO y ADMIN pueden crear/revocar.
 *       Lectura: cualquier usuario del tenant.
 *
 * Accesibilidad: WCAG 2.1 AA — contraste 4.5:1, foco visible, aria-live.
 */

import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";
import { StaffGsrnForm } from "./_components/staff-gsrn-form";
import { StaffGsrnActions } from "./_components/staff-gsrn-actions";

type StatusFilter = "all" | "ACTIVE" | "REVOKED";

export default function StaffGsrnPage() {
  const [status, setStatus]     = React.useState<StatusFilter>("all");
  const [rolFilter, setRol]     = React.useState("");
  const [page, setPage]         = React.useState(1);
  const [formOpen, setFormOpen] = React.useState(false);
  const [toast, setToast]       = React.useState<string | null>(null);

  const PAGE_SIZE = 25;

  const { data, isLoading, refetch } = trpc.staffGsrn.list.useQuery({
    limit:  PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    status: status === "all" ? undefined : status,
    rol:    rolFilter || undefined,
  });

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">GSRN Personal Clínico</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de identificadores GS1 para badges institucionales (AI 8018).
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>Nuevo GSRN</Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-1">
          {(["all", "ACTIVE", "REVOKED"] as StatusFilter[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "default" : "outline"}
              onClick={() => { setStatus(s); setPage(1); }}
              aria-pressed={status === s}
            >
              {s === "all" ? "Todos" : s === "ACTIVE" ? "Activos" : "Revocados"}
            </Button>
          ))}
        </div>

        <Input
          className="w-36"
          placeholder="Filtrar por rol"
          value={rolFilter}
          onChange={(e) => { setRol(e.target.value.toUpperCase()); setPage(1); }}
          aria-label="Filtrar por código de rol"
        />
      </div>

      {/* Tabla */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Cargando...
        </p>
      ) : (
        <>
          <Table aria-label="Catálogo GSRN personal clínico">
            <TableHeader>
              <TableRow>
                <TableHead>GSRN</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Turno</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Sin registros
                  </TableCell>
                </TableRow>
              ) : (
                (data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <code className="font-mono text-xs">
                        {row.gsrn.match(/.{1,4}/g)?.join(" ")}
                      </code>
                    </TableCell>
                    <TableCell>{row.nombre ?? "—"}</TableCell>
                    <TableCell>{row.rol ?? "—"}</TableCell>
                    <TableCell>{row.turno ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={row.status === "ACTIVE" ? "default" : "destructive"}
                        aria-label={`Estado: ${row.status}`}
                      >
                        {row.status === "ACTIVE" ? "Activo" : "Revocado"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(row.creadoEn).toLocaleDateString("es-SV")}
                    </TableCell>
                    <TableCell className="text-right">
                      <StaffGsrnActions
                        id={row.id}
                        gsrn={row.gsrn}
                        nombre={row.nombre}
                        rol={row.rol}
                        status={row.status}
                        onRevoked={() => {
                          showToast("GSRN revocado correctamente");
                          void refetch();
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Paginación simple */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Página {page}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(data?.length ?? 0) < PAGE_SIZE}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Dialog: Alta */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar GSRN profesional</DialogTitle>
          </DialogHeader>
          <StaffGsrnForm
            onSuccess={() => {
              setFormOpen(false);
              showToast("GSRN registrado correctamente");
              void refetch();
            }}
            onCancel={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Toast accesible */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded bg-primary px-4 py-2 text-sm text-primary-foreground shadow"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
