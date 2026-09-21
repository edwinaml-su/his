"use client";

/**
 * US-2.5 — Configuración admin de proveedores SSO.
 *
 * R1.4 (plan de remediación 2026-09) — reemplaza el localStorage MVP por
 * persistencia real vía `trpc.ssoProviderConfig` (tabla `SsoProviderConfig`,
 * sql/258). El flujo de login sigue sin cambios: el botón "Iniciar con
 * Microsoft" de /login usa el provider `azure` de Supabase Auth nativo
 * (configurado en el dashboard de Supabase), ajeno a esta pantalla. Esta
 * config alimenta la pantalla alterna `/sso` (selector de provider, hoy
 * stub: `initiateSsoLogin` siempre responde NOT_CONFIGURED).
 *
 * SIN client secrets: el formulario no pide "Client Secret" — la tabla
 * `SsoProviderConfig.config` (jsonb) solo guarda metadata no sensible
 * (clientId, redirectUri, dominio, auto-aprovisionamiento). Si un IdP real
 * necesita un secreto de aplicación, vive en env/Vercel o Supabase Vault,
 * nunca en esta tabla — ver cabecera de sql/258.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Alert, AlertDescription } from "@his/ui/components/alert";
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
import { ssoProviderEnum, type SsoProvider, type SsoProviderConfigMeta } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";

type ProviderRow = {
  id: string;
  provider: SsoProvider;
  displayName: string;
  enabled: boolean;
  config: SsoProviderConfigMeta;
};

const PROTOCOL_BY_PROVIDER: Record<SsoProvider, "SAML" | "OIDC" | "OAUTH2"> = {
  WORKOS: "SAML",
  AUTH0: "OIDC",
  GOOGLE_WORKSPACE: "OAUTH2",
  AZURE_AD: "OAUTH2",
};

export default function SsoConfigPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.ssoProviderConfig.list.useQuery();
  const rows = listQuery.data ?? [];

  const [editing, setEditing] = React.useState<ProviderRow | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<ProviderRow | null>(null);

  const upsertMut = trpc.ssoProviderConfig.upsert.useMutation({
    onSuccess: () => {
      utils.ssoProviderConfig.list.invalidate();
      setFormOpen(false);
      setEditing(null);
    },
  });

  const deleteMut = trpc.ssoProviderConfig.delete.useMutation({
    onSuccess: () => {
      utils.ssoProviderConfig.list.invalidate();
      setConfirmDelete(null);
    },
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Configuración SSO</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona los proveedores de Single Sign-On (SAML / OIDC / OAuth2) de tu organización.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Añadir proveedor
        </Button>
      </div>

      <Alert>
        <AlertDescription>
          Esta pantalla configura el selector alterno <code>/sso</code> (hoy en preparación:
          los botones muestran &quot;SSO en preparación&quot; hasta que se cablee el IdP real
          en Sprint 2). El login con Microsoft de la pantalla principal (
          <code>/login</code>) usa la integración nativa de Supabase Auth y no depende de esta
          tabla. Por seguridad, el <strong>Client Secret</strong> no se gestiona aquí — vive en
          variables de entorno o Supabase Vault.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Proveedores configurados</CardTitle>
          <CardDescription>
            {listQuery.isLoading
              ? "Cargando..."
              : rows.length === 0
                ? "Aún no hay proveedores configurados para esta organización."
                : `${rows.length} proveedor${rows.length === 1 ? "" : "es"} configurado${rows.length === 1 ? "" : "s"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? null : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Protocolo</TableHead>
                  <TableHead>Dominio</TableHead>
                  <TableHead>Auto-aprovisionamiento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.displayName}</TableCell>
                    <TableCell>{r.provider}</TableCell>
                    <TableCell>{PROTOCOL_BY_PROVIDER[r.provider]}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.config.organizationDomain ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.config.autoProvision ? (
                        <Badge variant="secondary">Sí</Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.enabled ? (
                        <Badge>Activo</Badge>
                      ) : (
                        <Badge variant="outline">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(r);
                          setFormOpen(true);
                        }}
                      >
                        Editar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(r)}>
                        Eliminar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ProviderFormDialog
        open={formOpen}
        initial={editing}
        pending={upsertMut.isPending}
        error={upsertMut.error?.message ?? null}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          upsertMut.reset();
        }}
        onSave={(input) => upsertMut.mutate(input)}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar proveedor</DialogTitle>
            <DialogDescription>
              ¿Eliminar la configuración de &quot;{confirmDelete?.displayName}&quot;? Esta acción
              no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => confirmDelete && deleteMut.mutate({ id: confirmDelete.id })}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface UpsertInput {
  provider: SsoProvider;
  displayName: string;
  enabled: boolean;
  config: SsoProviderConfigMeta;
}

interface ProviderFormDialogProps {
  open: boolean;
  initial: ProviderRow | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: UpsertInput) => void;
}

function ProviderFormDialog({
  open,
  initial,
  pending,
  error,
  onClose,
  onSave,
}: ProviderFormDialogProps) {
  const [provider, setProvider] = React.useState<SsoProvider>("GOOGLE_WORKSPACE");
  const [displayName, setDisplayName] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [redirectUri, setRedirectUri] = React.useState("");
  const [organizationDomain, setOrganizationDomain] = React.useState("");
  const [autoProvision, setAutoProvision] = React.useState(false);
  const [enabled, setEnabled] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    if (initial) {
      setProvider(initial.provider);
      setDisplayName(initial.displayName);
      setClientId(initial.config.clientId ?? "");
      setRedirectUri(initial.config.redirectUri ?? "");
      setOrganizationDomain(initial.config.organizationDomain ?? "");
      setAutoProvision(initial.config.autoProvision);
      setEnabled(initial.enabled);
    } else {
      setProvider("GOOGLE_WORKSPACE");
      setDisplayName("");
      setClientId("");
      setRedirectUri(typeof window !== "undefined" ? `${window.location.origin}/sso/callback` : "");
      setOrganizationDomain("");
      setAutoProvision(false);
      setEnabled(true);
    }
  }, [open, initial]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      provider,
      displayName,
      enabled,
      config: {
        clientId: clientId || undefined,
        redirectUri: redirectUri || undefined,
        organizationDomain: organizationDomain || undefined,
        autoProvision,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar proveedor" : "Nuevo proveedor SSO"}</DialogTitle>
          <DialogDescription>
            El Client Secret no se gestiona aquí — se configura por variable de entorno.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="provider">Proveedor</Label>
            <select
              id="provider"
              className="w-full rounded-md border bg-background p-2 text-sm"
              value={provider}
              onChange={(e) => setProvider(e.target.value as SsoProvider)}
            >
              {ssoProviderEnum.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt} ({PROTOCOL_BY_PROVIDER[opt]})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Nombre visible</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Hospital Central AD"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientId">Client ID</Label>
            <Input id="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="redirectUri">Redirect URI</Label>
            <Input
              id="redirectUri"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="organizationDomain">Dominio organización (opcional)</Label>
            <Input
              id="organizationDomain"
              value={organizationDomain}
              onChange={(e) => setOrganizationDomain(e.target.value)}
              placeholder="hospitalcentral.sv"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoProvision}
                onChange={(e) => setAutoProvision(e.target.checked)}
              />
              Auto-aprovisionamiento
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Activo
            </label>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {initial ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
