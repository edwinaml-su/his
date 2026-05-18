"use client";

/**
 * F2-S15 Stream D — Cola de usuarios inactivos para depuración anual.
 * US.F2.7.20 — ADM puede reactivar con motivo; DIR inicia depuración.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

type InactiveUser = {
  id: string;
  fullName: string;
  email: string;
  lastLoginAt: string | null;
};

function ReactivateDialog({
  user,
  onClose,
}: {
  user: InactiveUser;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const reactivate = trpc.rbac.reactivateUser.useMutation({
    onSuccess: onClose,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Reactivar Usuario</h2>
        <p className="mb-2 text-sm">
          <span className="font-medium">{user.fullName}</span> — {user.email}
        </p>
        <div className="space-y-2">
          <Label htmlFor="motivo">Motivo de reactivación *</Label>
          <Input
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: Retorno de licencia médica"
          />
        </div>
        {reactivate.isError && (
          <p className="mt-2 text-sm text-red-600">{reactivate.error.message}</p>
        )}
        <div className="mt-4 flex gap-2">
          <Button
            disabled={!motivo.trim() || reactivate.isPending}
            onClick={() => reactivate.mutate({ userId: user.id, motivo })}
          >
            {reactivate.isPending ? "Reactivando..." : "Reactivar"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function DepuracionPage() {
  const [dryRun, setDryRun] = React.useState(true);
  const [candidates, setCandidates] = React.useState<InactiveUser[]>([]);
  const [selected, setSelected] = React.useState<InactiveUser | null>(null);
  const [purged, setPurged] = React.useState<number | null>(null);

  const purgeMut = trpc.rbac.purgeInactiveUsers.useMutation({
    onSuccess: (data) => {
      setCandidates(
        data.users.map((u) => ({
          id:          u.id,
          fullName:    u.fullName,
          email:       u.email,
          lastLoginAt: u.lastLoginAt?.toString() ?? null,
        })),
      );
      if (!data.dryRun) setPurged(data.affected);
    },
  });

  return (
    <div className="space-y-6">
      {selected && (
        <ReactivateDialog user={selected} onClose={() => setSelected(null)} />
      )}

      <div>
        <h1 className="text-2xl font-bold">Depuración Anual de Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          US.F2.7.20 — Detecta y marca usuarios inactivos hace más de 1 año.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="h-4 w-4"
              />
              Simulación (dry-run — no aplica cambios)
            </label>
            <Button
              disabled={purgeMut.isPending}
              onClick={() => purgeMut.mutate({ dryRun, inactiveDays: 365 })}
            >
              {purgeMut.isPending
                ? "Procesando..."
                : dryRun
                  ? "Ver candidatos (simulación)"
                  : "Ejecutar depuración"}
            </Button>
          </div>
          {!dryRun && (
            <p className="mt-2 text-xs text-red-600">
              Modo real: los usuarios encontrados quedarán marcados como INACTIVE.
            </p>
          )}
        </CardContent>
      </Card>

      {purged !== null && (
        <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Depuración completada. {purged} usuario(s) marcados como INACTIVE.
        </div>
      )}

      {candidates.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {dryRun ? "Candidatos a depurar" : "Usuarios procesados"}
            </CardTitle>
            <Badge variant="secondary">{candidates.length}</Badge>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Nombre</th>
                  <th className="pb-2 pr-4">Email</th>
                  <th className="pb-2 pr-4">Último acceso</th>
                  <th className="pb-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 font-medium">{u.fullName}</td>
                    <td className="py-1.5 pr-4 text-muted-foreground">{u.email}</td>
                    <td className="py-1.5 pr-4 text-xs text-red-600">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleDateString("es-SV")
                        : "Nunca"}
                    </td>
                    <td className="py-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(u)}
                      >
                        Reactivar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {purgeMut.isError && (
        <p className="text-sm text-red-600">{purgeMut.error.message}</p>
      )}
    </div>
  );
}
