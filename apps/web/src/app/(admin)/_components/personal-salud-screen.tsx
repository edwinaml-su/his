"use client";

/**
 * Componente compartido de mantenimiento de personal de salud.
 *
 * Modelo B2B2C: usado por dos pantallas distintas:
 *   - /admin/medicos              kind="medicos"
 *   - /admin/profesionales-salud  kind="no_medicos"
 *
 * Funcionalidad:
 *   - Lista filtrable (search + activo).
 *   - Form modal "Nuevo" con DUI + nombre + JVPM/JVP + profesión + roles.
 *   - Edit inline en modal "Editar".
 *   - Toggle activo/inactivo con confirmación.
 *   - Indicador de firma electrónica activa por fila.
 *   - Toast de feedback en mutaciones.
 */
import * as React from "react";
import { UserPlus, UserCog, ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { Checkbox } from "@his/ui/components/checkbox";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";

export type PersonalKind = "medicos" | "no_medicos";

type ToastState = {
  title: string;
  description?: string;
  variant?: "default" | "success" | "destructive";
} | null;

type FormState = {
  documentoIdentidad: string;
  nombreCompleto: string;
  jvpmOJvp: string;
  profesion: string;
  rolCodigos: string[];
};

const EMPTY_FORM: FormState = {
  documentoIdentidad: "",
  nombreCompleto: "",
  jvpmOJvp: "",
  profesion: "",
  rolCodigos: [],
};

interface PersonalSaludScreenProps {
  kind: PersonalKind;
  title: string;
  subtitle: string;
  /** Etiqueta singular para mensajes — "médico", "profesional de la salud". */
  noun: string;
  /** Etiqueta para JVPM — "JVPM" (médicos) o "JVP/JNR" (enfermería). */
  jvpLabel: string;
  /** Hint del campo profesión por contexto. */
  profesionHint: string;
}

export function PersonalSaludScreen({
  kind,
  title,
  subtitle,
  noun,
  jvpLabel,
  profesionHint,
}: PersonalSaludScreenProps) {
  const [search, setSearch] = React.useState("");
  const [activoFilter, setActivoFilter] = React.useState<"activos" | "inactivos" | "todos">("activos");
  const [editTarget, setEditTarget] = React.useState<string | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [confirmToggle, setConfirmToggle] = React.useState<{
    id: string;
    nombre: string;
    activo: boolean;
  } | null>(null);
  const [toast, setToast] = React.useState<ToastState>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = React.useState<string | null>(null);

  const utils = trpc.useUtils();

  const listQuery = trpc.personalSalud.list.useQuery({
    kind,
    ...(search.trim() && { search: search.trim() }),
    ...(activoFilter === "activos"
      ? { activo: true }
      : activoFilter === "inactivos"
        ? { activo: false }
        : {}),
  });

  const rolesQuery = trpc.personalSalud.listRoles.useQuery({ kind });

  const detailQuery = trpc.personalSalud.get.useQuery(
    { id: editTarget ?? "" },
    { enabled: !!editTarget },
  );

  // Cargar form al abrir edit.
  React.useEffect(() => {
    if (detailQuery.data && editTarget) {
      setForm({
        documentoIdentidad: detailQuery.data.documentoIdentidad,
        nombreCompleto: detailQuery.data.nombreCompleto,
        jvpmOJvp: detailQuery.data.jvpmOJvp ?? "",
        profesion: detailQuery.data.profesion ?? "",
        rolCodigos: detailQuery.data.roles.map((r) => r.codigo),
      });
    }
  }, [detailQuery.data, editTarget]);

  const createMut = trpc.personalSalud.create.useMutation({
    onSuccess: () => {
      utils.personalSalud.list.invalidate();
      setNewOpen(false);
      setForm(EMPTY_FORM);
      setFormError(null);
      setToast({ title: `${noun} creado`, variant: "success" });
    },
    onError: (err) => setFormError(err.message),
  });

  const updateMut = trpc.personalSalud.update.useMutation({
    onSuccess: () => {
      utils.personalSalud.list.invalidate();
      setEditTarget(null);
      setFormError(null);
      setToast({ title: "Cambios guardados", variant: "success" });
    },
    onError: (err) => setFormError(err.message),
  });

  const setActiveMut = trpc.personalSalud.setActive.useMutation({
    onSuccess: (_, vars) => {
      utils.personalSalud.list.invalidate();
      setConfirmToggle(null);
      setToast({
        title: vars.activo ? "Reactivado" : "Desactivado",
        variant: "success",
      });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleSubmitNew() {
    setFormError(null);
    if (form.documentoIdentidad.trim().length < 3) {
      setFormError("Documento de identidad es obligatorio.");
      return;
    }
    if (form.nombreCompleto.trim().length < 3) {
      setFormError("Nombre completo es obligatorio.");
      return;
    }
    if (form.rolCodigos.length === 0) {
      setFormError("Selecciona al menos un rol ECE.");
      return;
    }
    createMut.mutate({
      documentoIdentidad: form.documentoIdentidad.trim(),
      nombreCompleto: form.nombreCompleto.trim(),
      jvpmOJvp: form.jvpmOJvp.trim() || undefined,
      profesion: form.profesion.trim() || undefined,
      rolCodigos: form.rolCodigos,
    });
  }

  function handleSubmitEdit() {
    if (!editTarget) return;
    setFormError(null);
    if (form.nombreCompleto.trim().length < 3) {
      setFormError("Nombre completo es obligatorio.");
      return;
    }
    if (form.rolCodigos.length === 0) {
      setFormError("Selecciona al menos un rol ECE.");
      return;
    }
    updateMut.mutate({
      id: editTarget,
      nombreCompleto: form.nombreCompleto.trim(),
      jvpmOJvp: form.jvpmOJvp.trim() || null,
      profesion: form.profesion.trim() || null,
      rolCodigos: form.rolCodigos,
    });
  }

  function toggleRol(codigo: string) {
    setForm((f) => ({
      ...f,
      rolCodigos: f.rolCodigos.includes(codigo)
        ? f.rolCodigos.filter((c) => c !== codigo)
        : [...f.rolCodigos, codigo],
    }));
  }

  const rows = listQuery.data ?? [];
  const roles = rolesQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <UserCog className="h-6 w-6" aria-hidden />
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          onClick={() => {
            setForm(EMPTY_FORM);
            setFormError(null);
            setNewOpen(true);
          }}
        >
          <UserPlus className="mr-2 h-4 w-4" aria-hidden />
          Nuevo {noun}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="search" className="text-xs">Buscar (nombre o documento)</Label>
              <Input
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ej. María Pérez o 12345678-9"
              />
            </div>
            <div>
              <Label className="text-xs">Estado</Label>
              <Select
                value={activoFilter}
                onValueChange={(v) => setActivoFilter(v as typeof activoFilter)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activos">Solo activos</SelectItem>
                  <SelectItem value="inactivos">Solo inactivos</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <span className="ml-auto text-xs text-muted-foreground">
              {listQuery.isLoading ? "Cargando…" : `${rows.length} resultado(s)`}
            </span>
          </div>

          {listQuery.error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {listQuery.error.message}
            </p>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Nombre completo</TableHead>
                  <TableHead>{jvpLabel}</TableHead>
                  <TableHead>Profesión</TableHead>
                  <TableHead>Roles ECE</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-40 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !listQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                      Sin {noun}s para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.documentoIdentidad}</TableCell>
                    <TableCell className="font-medium">{p.nombreCompleto}</TableCell>
                    <TableCell className="font-mono text-xs">{p.jvpmOJvp ?? "—"}</TableCell>
                    <TableCell className="text-sm">{p.profesion ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {p.roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Sin roles</span>
                        ) : (
                          p.roles.map((r) => (
                            <Badge key={r.codigo} variant="secondary" className="text-xs">
                              {r.nombre}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.activo ? (
                        <Badge variant="success">Activo</Badge>
                      ) : (
                        <Badge variant="outline">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEditTarget(p.id)}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setConfirmToggle({ id: p.id, nombre: p.nombreCompleto, activo: !p.activo })
                          }
                        >
                          {p.activo ? "Desactivar" : "Reactivar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog: Nuevo */}
      <Dialog open={newOpen} onOpenChange={(o) => !o && setNewOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo {noun}</DialogTitle>
            <DialogDescription>
              Registra los datos del {noun} y asigna los roles ECE necesarios.
            </DialogDescription>
          </DialogHeader>
          <PersonalForm
            mode="create"
            form={form}
            setForm={setForm}
            roles={roles}
            toggleRol={toggleRol}
            jvpLabel={jvpLabel}
            profesionHint={profesionHint}
            error={formError}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmitNew} disabled={createMut.isPending}>
              {createMut.isPending ? "Guardando…" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Editar */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar {noun}</DialogTitle>
            <DialogDescription>
              Cambia datos básicos y/o roles asignados. El documento de identidad no
              es editable — para cambiarlo, dé de baja y registre uno nuevo.
            </DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : detailQuery.data ? (
            <>
              <PersonalForm
                mode="edit"
                form={form}
                setForm={setForm}
                roles={roles}
                toggleRol={toggleRol}
                jvpLabel={jvpLabel}
                profesionHint={profesionHint}
                error={formError}
                extraInfo={
                  <p className="text-xs text-muted-foreground">
                    Firma electrónica:{" "}
                    {detailQuery.data.firmaActiva ? (
                      <span className="text-green-700 font-medium inline-flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" aria-hidden /> activa
                      </span>
                    ) : (
                      <span className="text-amber-700 font-medium inline-flex items-center gap-1">
                        <ShieldAlert className="h-3 w-3" aria-hidden /> sin configurar
                      </span>
                    )}
                  </p>
                }
              />
            </>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmitEdit} disabled={updateMut.isPending}>
              {updateMut.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirmar toggle */}
      <Dialog open={!!confirmToggle} onOpenChange={(o) => !o && setConfirmToggle(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmToggle?.activo ? "Reactivar" : "Desactivar"} {noun}
            </DialogTitle>
            <DialogDescription>
              {confirmToggle?.activo ? (
                <>El {noun} <strong>{confirmToggle?.nombre}</strong> volverá a estar disponible para asignaciones clínicas.</>
              ) : (
                <>El {noun} <strong>{confirmToggle?.nombre}</strong> dejará de aparecer en selectores activos. Los registros históricos se conservan.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmToggle(null)}>
              Cancelar
            </Button>
            <Button
              variant={confirmToggle?.activo ? "default" : "destructive"}
              disabled={setActiveMut.isPending}
              onClick={() => {
                if (confirmToggle) {
                  setActiveMut.mutate({ id: confirmToggle.id, activo: confirmToggle.activo });
                }
              }}
            >
              {setActiveMut.isPending
                ? "Aplicando…"
                : confirmToggle?.activo
                  ? "Reactivar"
                  : "Desactivar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description && <ToastDescription>{toast.description}</ToastDescription>}
          </div>
        </Toast>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componente: form reutilizable (create y edit)
// ─────────────────────────────────────────────────────────────────────────────

interface PersonalFormProps {
  mode: "create" | "edit";
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  roles: { codigo: string; nombre: string; tipo: "medico" | "no_medico" }[];
  toggleRol: (codigo: string) => void;
  jvpLabel: string;
  profesionHint: string;
  error: string | null;
  extraInfo?: React.ReactNode;
}

function PersonalForm({
  mode,
  form,
  setForm,
  roles,
  toggleRol,
  jvpLabel,
  profesionHint,
  error,
  extraInfo,
}: PersonalFormProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="documentoIdentidad">
            Documento de identidad <span aria-hidden className="text-destructive">*</span>
          </Label>
          <Input
            id="documentoIdentidad"
            value={form.documentoIdentidad}
            onChange={(e) =>
              setForm((f) => ({ ...f, documentoIdentidad: e.target.value }))
            }
            placeholder="DUI 00000000-0"
            disabled={mode === "edit"}
            aria-describedby="documentoIdentidad-hint"
          />
          <p id="documentoIdentidad-hint" className="text-xs text-muted-foreground">
            DUI / NIT / pasaporte — no editable después de creación.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nombreCompleto">
            Nombre completo <span aria-hidden className="text-destructive">*</span>
          </Label>
          <Input
            id="nombreCompleto"
            value={form.nombreCompleto}
            onChange={(e) => setForm((f) => ({ ...f, nombreCompleto: e.target.value }))}
            placeholder="Ej. Dra. María Pérez Hernández"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="jvpmOJvp">{jvpLabel}</Label>
          <Input
            id="jvpmOJvp"
            value={form.jvpmOJvp}
            onChange={(e) => setForm((f) => ({ ...f, jvpmOJvp: e.target.value }))}
            placeholder="Ej. JVPM-12345"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profesion">Profesión</Label>
          <Input
            id="profesion"
            value={form.profesion}
            onChange={(e) => setForm((f) => ({ ...f, profesion: e.target.value }))}
            placeholder={profesionHint}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>
          Roles ECE <span aria-hidden className="text-destructive">*</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          Selecciona uno o más roles según el alcance funcional del profesional.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {roles.map((r) => {
            const checked = form.rolCodigos.includes(r.codigo);
            return (
              <label
                key={r.codigo}
                className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/50"
              >
                <Checkbox
                  id={`rol-${r.codigo}`}
                  checked={checked}
                  onCheckedChange={() => toggleRol(r.codigo)}
                />
                <span className="text-sm">
                  <span className="font-medium">{r.nombre}</span>
                  <span className="text-xs text-muted-foreground block">
                    Código ECE: {r.codigo}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {extraInfo}

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
