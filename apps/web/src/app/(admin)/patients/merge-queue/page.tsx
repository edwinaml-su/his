"use client";

/**
 * US.F2.7.41 — Cola de merges de expedientes ECE pendientes (admin).
 *
 * Muestra solicitudes en estado PENDIENTE de la organización.
 * El DIR puede confirmar el merge ingresando las dos firmas (hashes PIN).
 * URL: /patients/duplicates (admin)
 */

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { trpc } from "@/lib/trpc/react";

function MergeConfirmDialog({
  mergeId,
  canonical,
  merged,
  onClose,
}: {
  mergeId: string;
  canonical: { mrn: string; firstName: string; lastName: string };
  merged: { mrn: string; firstName: string; lastName: string };
  onClose: () => void;
}) {
  const [userId1, setUserId1] = React.useState("");
  const [userId2, setUserId2] = React.useState("");
  const [firmaDir1, setFirmaDir1] = React.useState("");
  const [firmaDir2, setFirmaDir2] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const utils = trpc.useUtils();

  const confirm = trpc.patientDedup.confirmEceMerge.useMutation({
    onSuccess: () => {
      void utils.patientDedup.listPendingMerges.invalidate();
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  const canSubmit =
    userId1.trim().length > 0 &&
    userId2.trim().length > 0 &&
    /^\d{6,8}$/.test(firmaDir1.trim()) &&
    /^\d{6,8}$/.test(firmaDir2.trim()) &&
    !confirm.isPending;

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Confirmar fusión de expedientes</DialogTitle>
        <DialogDescription>
          Esta operación es irreversible. Requiere la firma PIN del Director y del Director
          Médico.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2 text-sm">
        <p>
          <strong>Expediente canónico (superviviente):</strong>{" "}
          {canonical.lastName}, {canonical.firstName}{" "}
          <span className="font-mono text-xs text-muted-foreground">MRN {canonical.mrn}</span>
        </p>
        <p>
          <strong>Expediente a absorber:</strong>{" "}
          {merged.lastName}, {merged.firstName}{" "}
          <span className="font-mono text-xs text-muted-foreground">MRN {merged.mrn}</span>
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="user1">Usuario Director (UUID)</Label>
          <Input
            id="user1"
            type="text"
            value={userId1}
            onChange={(e) => setUserId1(e.target.value)}
            placeholder="UUID del Director"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="firma1">PIN Director (6-8 dígitos)</Label>
          <Input
            id="firma1"
            type="password"
            inputMode="numeric"
            value={firmaDir1}
            onChange={(e) => setFirmaDir1(e.target.value)}
            placeholder="PIN del Director"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="user2">Usuario Director Médico (UUID)</Label>
          <Input
            id="user2"
            type="text"
            value={userId2}
            onChange={(e) => setUserId2(e.target.value)}
            placeholder="UUID del Director Médico (debe ser distinto al primero)"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="firma2">PIN Director Médico (6-8 dígitos)</Label>
          <Input
            id="firma2"
            type="password"
            inputMode="numeric"
            value={firmaDir2}
            onChange={(e) => setFirmaDir2(e.target.value)}
            placeholder="PIN del Director Médico"
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={confirm.isPending}>
          Cancelar
        </Button>
        <Button
          variant="destructive"
          disabled={!canSubmit}
          onClick={() =>
            confirm.mutate({
              mergeId,
              firmante1: { userId: userId1.trim(), pin: firmaDir1.trim() },
              firmante2: { userId: userId2.trim(), pin: firmaDir2.trim() },
            })
          }
        >
          {confirm.isPending ? "Ejecutando…" : "Confirmar fusión"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export default function AdminPatientDuplicatesPage() {
  const [selectedMerge, setSelectedMerge] = React.useState<{
    id: string;
    canonical: { mrn: string; firstName: string; lastName: string };
    merged: { mrn: string; firstName: string; lastName: string };
  } | null>(null);

  const merges = trpc.patientDedup.listPendingMerges.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cola de fusión de expedientes</h1>
        <p className="text-sm text-muted-foreground">
          US.F2.7.41 — Solicitudes pendientes de fusión NTEC (doble firma DIR requerida).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Solicitudes pendientes</CardTitle>
          <CardDescription>
            Cada fusión requiere el PIN del Director y del Director Médico. Acción irreversible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {merges.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : merges.error ? (
            <p className="text-sm text-destructive">{merges.error.message}</p>
          ) : !merges.data || merges.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin solicitudes de fusión pendientes.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canónico (superviviente)</TableHead>
                  <TableHead>A absorber</TableHead>
                  <TableHead>Solicitado por</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {merges.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="font-medium">
                        {row.canonicalPatient.lastName}, {row.canonicalPatient.firstName}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        MRN {row.canonicalPatient.mrn}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">
                        {row.mergedPatient.lastName}, {row.mergedPatient.firstName}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        MRN {row.mergedPatient.mrn}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.solicitadoPor?.fullName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="border-amber-500 text-amber-700"
                      >
                        {row.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          setSelectedMerge({
                            id: row.id,
                            canonical: row.canonicalPatient,
                            merged: row.mergedPatient,
                          })
                        }
                      >
                        Ejecutar fusión
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedMerge)}
        onOpenChange={(open) => !open && setSelectedMerge(null)}
      >
        {selectedMerge ? (
          <MergeConfirmDialog
            mergeId={selectedMerge.id}
            canonical={selectedMerge.canonical}
            merged={selectedMerge.merged}
            onClose={() => setSelectedMerge(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
