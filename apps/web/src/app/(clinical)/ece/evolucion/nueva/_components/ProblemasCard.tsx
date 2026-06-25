"use client";

/**
 * Tarjeta de lista de problemas (POMR, CC-0004).
 *
 * Muestra un grid/tabla de problemas con columnas: #, Problema, S (preview), O (preview),
 * Acciones (Editar / Eliminar). El botón "Agregar problema" abre el modal de captura.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import type { ProblemaItem } from "./ProblemasModal";

// ─── Helper ──────────────────────────────────────────────────────────────────

function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface ProblemasCardProps {
  problemas: ProblemaItem[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}

export function ProblemasCard({ problemas, onAdd, onEdit, onDelete }: ProblemasCardProps) {
  return (
    <Card className="border-l-4 border-blue-300 dark:border-blue-700">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">
            Problemas
          </CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAdd}
            aria-label="Agregar problema"
          >
            Agregar problema
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {problemas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay problemas registrados. Agregue el primero.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="w-8">#</TableHead>
                <TableHead scope="col">Problema</TableHead>
                <TableHead scope="col">S</TableHead>
                <TableHead scope="col">O</TableHead>
                <TableHead scope="col" className="w-32">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {problemas.map((p, i) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{p.descripcion}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.subjetivo ? truncate(p.subjetivo) : <span className="italic">—</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.objetivo ? truncate(p.objetivo) : <span className="italic">—</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(i)}
                        aria-label={`Editar problema ${i + 1}`}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(i)}
                        aria-label={`Eliminar problema ${i + 1}`}
                        className="text-destructive hover:text-destructive"
                      >
                        Eliminar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
