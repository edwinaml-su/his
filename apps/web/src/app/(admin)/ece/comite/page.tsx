"use client";

/**
 * Comité del Expediente Clínico — Registro de Minutas.
 *
 * US.F2.7.46 — Minutas auditables con hash chain.
 * NTEC Art. 32.
 *
 * Acceso: roles DIR, ARCH, ADMIN.
 * Accesibilidad: WCAG 2.2 AA.
 */

import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { Separator } from "@his/ui/components/separator";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estadoBadge(estado: string) {
  if (estado === "firmada") {
    return <Badge className="bg-green-100 text-green-800">Firmada</Badge>;
  }
  return <Badge variant="outline">Borrador</Badge>;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-SV", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Formulario nueva minuta
// ---------------------------------------------------------------------------

interface NuevaMinutaFormProps {
  onSuccess: () => void;
}

function NuevaMinutaForm({ onSuccess }: NuevaMinutaFormProps) {
  const utils = trpc.useUtils();
  const create = trpc.comiteEce.create.useMutation({
    onSuccess: () => {
      void utils.comiteEce.list.invalidate();
      onSuccess();
    },
  });

  const [fecha, setFecha] = React.useState("");
  const [asistenteInput, setAsistenteInput] = React.useState("");
  const [temaInput, setTemaInput] = React.useState("");
  const [asistentes, setAsistentes] = React.useState<
    Array<{ nombre: string; rol: string }>
  >([]);
  const [temas, setTemas] = React.useState<
    Array<{ numero: number; tema: string }>
  >([]);

  function addAsistente() {
    const parts = asistenteInput.split("|");
    if (parts.length < 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      alert('Formato: "Nombre | Rol"');
      return;
    }
    setAsistentes((prev) => [
      ...prev,
      { nombre: parts[0]!.trim(), rol: parts[1]!.trim() },
    ]);
    setAsistenteInput("");
  }

  function addTema() {
    if (!temaInput.trim()) return;
    setTemas((prev) => [
      ...prev,
      { numero: prev.length + 1, tema: temaInput.trim() },
    ]);
    setTemaInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fecha) return;
    if (asistentes.length === 0) {
      alert("Agregue al menos un asistente.");
      return;
    }
    if (temas.length === 0) {
      alert("Agregue al menos un tema de agenda.");
      return;
    }

    create.mutate({
      fechaReunion: new Date(fecha),
      asistentes,
      temasAgenda: temas,
      acuerdos: [],
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Nueva minuta del comité">
      <div>
        <Label htmlFor="fecha-reunion">Fecha de reunión *</Label>
        <Input
          id="fecha-reunion"
          type="date"
          required
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          max={new Date().toISOString().split("T")[0]}
        />
      </div>

      <div>
        <Label htmlFor="asistente-input">
          Asistentes (formato: Nombre | Rol)
        </Label>
        <div className="flex gap-2">
          <Input
            id="asistente-input"
            placeholder="Dr. García | MC"
            value={asistenteInput}
            onChange={(e) => setAsistenteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAsistente();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addAsistente}>
            Agregar
          </Button>
        </div>
        {asistentes.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground" aria-label="Asistentes agregados">
            {asistentes.map((a, i) => (
              <li key={i}>
                {a.nombre} — {a.rol}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <Label htmlFor="tema-input">Temas de agenda</Label>
        <div className="flex gap-2">
          <Input
            id="tema-input"
            placeholder="Indicadores de calidad documental Q1"
            value={temaInput}
            onChange={(e) => setTemaInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTema();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addTema}>
            Agregar
          </Button>
        </div>
        {temas.length > 0 && (
          <ol className="mt-1 list-decimal pl-5 text-sm text-muted-foreground" aria-label="Temas agregados">
            {temas.map((t) => (
              <li key={t.numero}>{t.tema}</li>
            ))}
          </ol>
        )}
      </div>

      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Guardando…" : "Crear minuta"}
      </Button>

      {create.isError && (
        <p role="alert" className="text-sm text-destructive">
          Error: {create.error.message}
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function ComiteEcePage() {
  const [page, setPage] = React.useState(1);
  const [showForm, setShowForm] = React.useState(false);

  const { data, isLoading, isError } = trpc.comiteEce.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
  });

  const firmar = trpc.comiteEce.firmar.useMutation({
    onSuccess: () => void window.location.reload(),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <main className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Comité ECE — Minutas</h1>
        <p className="text-sm text-muted-foreground">
          Art. 32 NTEC — Registro de reuniones del Comité del Expediente
          Clínico con minutas auditables e inmutables post-firma.
        </p>
      </header>

      <div className="flex justify-end">
        <Button
          onClick={() => setShowForm((v) => !v)}
          aria-expanded={showForm}
          aria-controls="nueva-minuta-form"
        >
          {showForm ? "Cancelar" : "Nueva minuta"}
        </Button>
      </div>

      {showForm && (
        <Card id="nueva-minuta-form">
          <CardHeader>
            <CardTitle>Registrar reunión del comité</CardTitle>
          </CardHeader>
          <CardContent>
            <NuevaMinutaForm onSuccess={() => setShowForm(false)} />
          </CardContent>
        </Card>
      )}

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Historial de minutas</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {isError && (
            <p role="alert" className="text-sm text-destructive">
              Error al cargar minutas.
            </p>
          )}

          {!isLoading && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay minutas registradas.
            </p>
          )}

          {items.length > 0 && (
            <>
              <Table aria-label="Historial de minutas del Comité ECE">
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Asistentes</TableHead>
                    <TableHead>Temas</TableHead>
                    <TableHead>Hash chain</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((m) => {
                    const asistentes = Array.isArray(m.asistentes) ? m.asistentes : [];
                    const temas = Array.isArray(m.temas_agenda) ? m.temas_agenda : [];

                    return (
                      <TableRow key={m.id}>
                        <TableCell>{formatDate(m.fecha_reunion)}</TableCell>
                        <TableCell>{estadoBadge(m.estado)}</TableCell>
                        <TableCell>
                          {asistentes.length} participante
                          {asistentes.length !== 1 ? "s" : ""}
                        </TableCell>
                        <TableCell>{temas.length} tema{temas.length !== 1 ? "s" : ""}</TableCell>
                        <TableCell>
                          {m.chain_hash ? (
                            <code
                              className="text-xs text-muted-foreground"
                              title={m.chain_hash}
                              aria-label="Hash de cadena de integridad"
                            >
                              {m.chain_hash.slice(0, 12)}…
                            </code>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pendiente</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {m.estado === "borrador" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={firmar.isPending}
                              onClick={() => {
                                const firmaId = prompt(
                                  "Ingrese ID de firma electrónica del presidente del comité (UUID):",
                                );
                                if (firmaId?.match(/^[0-9a-f-]{36}$/i)) {
                                  firmar.mutate({
                                    id: m.id,
                                    firmaPresidenteId: firmaId,
                                  });
                                }
                              }}
                              aria-label={`Firmar minuta del ${formatDate(m.fecha_reunion)}`}
                            >
                              Firmar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Paginación */}
              {totalPages > 1 && (
                <nav
                  className="mt-4 flex items-center justify-between text-sm"
                  aria-label="Paginación de minutas"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    aria-label="Página anterior"
                  >
                    Anterior
                  </Button>
                  <span>
                    Página {page} de {totalPages} ({total} minutas)
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Página siguiente"
                  >
                    Siguiente
                  </Button>
                </nav>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
