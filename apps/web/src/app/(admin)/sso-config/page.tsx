"use client";

/**
 * US-2.5 — Configuración admin de proveedores SSO.
 *
 * MVP STUB. Tabla CRUD que persiste en localStorage (cliente). Sirve para:
 *   - Documentar la forma del modelo `SsoProvider` para Sprint 2.
 *   - Permitir a admins "preconfigurar" providers que se migrarán a BD.
 *   - Pruebas manuales de UX antes de cablear el IdP real.
 *
 * NO toca BD: cuando se implemente Sprint 2, los datos de localStorage se
 * descartan y todos los providers se gestionan via Prisma + RLS por org.
 *
 * Persistencia localStorage justificada solo para MVP — explícitamente
 * documentado en /sso-config para que admins entiendan que NO se sincroniza
 * entre navegadores ni dispositivos.
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
import {
  ssoProviderConfigSchema,
  ssoProviderEnum,
  ssoProtocolEnum,
  type SsoProvider,
  type SsoProviderConfig,
} from "@his/contracts/schemas/sso";

const STORAGE_KEY = "his.sso.providers.mvp";

type StoredConfig = SsoProviderConfig & { id: string };

function loadFromStorage(): StoredConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is StoredConfig => {
      const r = ssoProviderConfigSchema.safeParse(row);
      return r.success && !!r.data.id;
    });
  } catch {
    return [];
  }
}

function saveToStorage(rows: StoredConfig[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

const PROTOCOL_BY_PROVIDER: Record<SsoProvider, "SAML" | "OIDC" | "OAUTH2"> = {
  WORKOS: "SAML",
  AUTH0: "OIDC",
  GOOGLE_WORKSPACE: "OAUTH2",
  AZURE_AD: "OAUTH2",
};

export default function SsoConfigPage() {
  const [rows, setRows] = React.useState<StoredConfig[]>([]);
  const [editing, setEditing] = React.useState<StoredConfig | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<StoredConfig | null>(null);

  React.useEffect(() => {
    setRows(loadFromStorage());
  }, []);

  const handleSave = (data: StoredConfig) => {
    const next = editing
      ? rows.map((r) => (r.id === editing.id ? data : r))
      : [...rows, data];
    setRows(next);
    saveToStorage(next);
    setFormOpen(false);
    setEditing(null);
  };

  const handleDelete = (row: StoredConfig) => {
    const next = rows.filter((r) => r.id !== row.id);
    setRows(next);
    saveToStorage(next);
    setConfirmDelete(null);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Configuración SSO</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona los proveedores de Single Sign-On (SAML / OIDC / OAuth2).
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
          <strong>MVP — Configuración no persistente.</strong> Los proveedores
          se guardan en almacenamiento local del navegador y NO se sincronizan
          con la base de datos. La activación efectiva de SSO está planificada
          para Sprint 2 (Supabase Auth nativo + WorkOS para SAML).
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Proveedores configurados</CardTitle>
          <CardDescription>
            {rows.length === 0
              ? "Aún no hay proveedores. Añade uno para preparar Sprint 2."
              : `${rows.length} proveedor${rows.length === 1 ? "" : "es"} en cola para Sprint 2.`}
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
                    <TableCell>{r.protocol}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.organizationDomain ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.autoProvision ? (
                        <Badge variant="secondary">Sí</Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.active ? (
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(r)}
                      >
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
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar proveedor</DialogTitle>
            <DialogDescription>
              ¿Eliminar la configuración de "{confirmDelete?.displayName}"? Esta
              acción no se puede deshacer (en MVP).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ProviderFormDialogProps {
  open: boolean;
  initial: StoredConfig | null;
  onClose: () => void;
  onSave: (config: StoredConfig) => void;
}

function ProviderFormDialog({ open, initial, onClose, onSave }: ProviderFormDialogProps) {
  const [provider, setProvider] = React.useState<SsoProvider>("GOOGLE_WORKSPACE");
  const [displayName, setDisplayName] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [redirectUri, setRedirectUri] = React.useState("");
  const [organizationDomain, setOrganizationDomain] = React.useState("");
  const [autoProvision, setAutoProvision] = React.useState(false);
  const [active, setActive] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (initial) {
      setProvider(initial.provider);
      setDisplayName(initial.displayName);
      setClientId(initial.clientId);
      setClientSecret(""); // No precargamos secretos por seguridad UI
      setRedirectUri(initial.redirectUri);
      setOrganizationDomain(initial.organizationDomain ?? "");
      setAutoProvision(initial.autoProvision);
      setActive(initial.active);
    } else {
      setProvider("GOOGLE_WORKSPACE");
      setDisplayName("");
      setClientId("");
      setClientSecret("");
      setRedirectUri(typeof window !== "undefined" ? `${window.location.origin}/sso/callback` : "");
      setOrganizationDomain("");
      setAutoProvision(false);
      setActive(true);
    }
    setError(null);
  }, [open, initial]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const candidate: SsoProviderConfig = {
      id: initial?.id ?? crypto.randomUUID(),
      provider,
      protocol: PROTOCOL_BY_PROVIDER[provider],
      displayName,
      clientId,
      clientSecret: clientSecret || initial?.clientSecret,
      redirectUri,
      organizationDomain: organizationDomain || undefined,
      // Mock: en MVP no hay org real, usamos UUID nil para satisfacer schema.
      organizationId: initial?.organizationId ?? "00000000-0000-0000-0000-000000000000",
      active,
      autoProvision,
    };

    const parsed = ssoProviderConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }

    onSave({ ...parsed.data, id: candidate.id! } as StoredConfig);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar proveedor" : "Nuevo proveedor SSO"}</DialogTitle>
          <DialogDescription>
            Configuración para Sprint 2. En MVP no se aplica.
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
            <Input
              id="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientSecret">
              Client Secret {initial ? "(dejar en blanco para no cambiar)" : ""}
            </Label>
            <Input
              id="clientSecret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="redirectUri">Redirect URI</Label>
            <Input
              id="redirectUri"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="organizationDomain">
              Dominio organización (opcional)
            </Label>
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
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
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
            <Button type="submit">{initial ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
