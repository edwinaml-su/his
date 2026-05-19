"use client";

/**
 * Workflow Designer — Lista de tipos de documento.
 *
 * US: Motor de workflow ECE data-driven (Fase 2 Sprint 1).
 * Muestra todos los tipos de documento configurados (ece.tipo_documento).
 * Cada tarjeta es clickeable y lleva a la vista de grafo del workflow.
 *
 * Roles: WORKFLOW_DESIGNER, DIR (requireRole en router — el backend rechaza
 * cualquier query de usuario sin esos roles; la UI muestra la lista vacía con
 * un mensaje orientativo si el usuario no tiene rol suficiente).
 */
import * as React from "react";
import Link from "next/link";
import { Badge } from "@his/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

/** Colores de badge por modalidad. */
const MODALIDAD_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  ambulatorio: "secondary",
  hospitalario: "default",
  ambos: "outline",
};

/** Colores de badge por tipo_registro. */
const TIPO_REGISTRO_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  transaccional: "default",
  maestro: "secondary",
  historico: "outline",
};

export default function WorkflowDesignerPage() {
  const { data: tiposDocs, isLoading, error } = trpc.workflowTipoDoc.list.useQuery({
    soloActivos: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg border bg-muted"
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader />
        <Alert variant="destructive">
          <AlertTitle>Error al cargar tipos de documento</AlertTitle>
          <AlertDescription>{String(error.message)}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const docs = tiposDocs ?? [];

  return (
    <div className="space-y-4">
      <PageHeader />

      {docs.length === 0 ? (
        <Alert>
          <AlertTitle>Sin tipos de documento configurados</AlertTitle>
          <AlertDescription>
            Crea el primer tipo de documento desde la API o solicita acceso con rol{" "}
            <code>WORKFLOW_DESIGNER</code> o <code>DIR</code>.
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Tipos de documento"
      >
        {docs.map(
          (doc: {
            id: string;
            codigo: string;
            nombre: string;
            tipo_registro: string;
            modalidad: string;
            activo: boolean;
            inmutable: boolean;
          }) => (
            <Link
              key={doc.id}
              href={`/workflow-designer/${doc.codigo}`}
              className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
              aria-label={`Ver workflow de ${doc.nombre}`}
            >
              <Card
                className={`h-full transition-shadow group-hover:shadow-md ${
                  !doc.activo ? "opacity-60" : ""
                }`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-semibold leading-tight">
                      {doc.nombre}
                    </CardTitle>
                    {!doc.activo && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        Inactivo
                      </Badge>
                    )}
                  </div>
                  <code className="text-xs text-muted-foreground">{doc.codigo}</code>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      variant={MODALIDAD_VARIANT[doc.modalidad] ?? "outline"}
                      className="text-xs"
                    >
                      {doc.modalidad}
                    </Badge>
                    <Badge
                      variant={TIPO_REGISTRO_VARIANT[doc.tipo_registro] ?? "outline"}
                      className="text-xs"
                    >
                      {doc.tipo_registro}
                    </Badge>
                    {doc.inmutable && (
                      <Badge variant="secondary" className="text-xs">
                        inmutable
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold">Workflow Designer</h1>
        <p className="text-sm text-muted-foreground">
          Motor ECE data-driven — configura estados, transiciones y roles sin redeploy.
          Requiere rol <code>WORKFLOW_DESIGNER</code> o <code>DIR</code>.
        </p>
      </div>
    </div>
  );
}
