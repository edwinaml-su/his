"use client";

/**
 * Detalle de un profesional de salud — usado por:
 *   - /admin/medicos/[id]
 *   - /admin/profesionales-salud/[id]
 *
 * 3 tabs:
 *   1. Datos básicos       — datos demográficos + roles + estado firma.
 *   2. Pacientes referidos — vista B2B2C: pacientes que el profesional atiende.
 *   3. Cuenta de acceso    — vincula/desvincula User HIS para login + auditoría.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, ShieldAlert, Link2, Unlink, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@his/ui/components/tabs";
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

interface PersonalSaludDetailProps {
  personalId: string;
  /** Para el breadcrumb y URL de "volver". */
  backHref: string;
  backLabel: string;
}

export function PersonalSaludDetail({ personalId, backHref, backLabel }: PersonalSaludDetailProps) {
  const utils = trpc.useUtils();
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkSearch, setLinkSearch] = React.useState("");
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const personalQuery = trpc.personalSalud.get.useQuery({ id: personalId });
  const referidosQuery = trpc.personalSalud.getPacientesReferidos.useQuery({ personalId });

  const userSearchQuery = trpc.personalSalud.searchAvailableUsers.useQuery(
    { search: linkSearch.trim(), limit: 10 },
    { enabled: linkSearch.trim().length >= 2 },
  );

  const linkMut = trpc.personalSalud.linkAuthUser.useMutation({
    onSuccess: (data) => {
      utils.personalSalud.get.invalidate();
      utils.personalSalud.getPacientesReferidos.invalidate();
      setLinkOpen(false);
      setLinkSearch("");
      setToast({ title: "Cuenta vinculada", description: data.userEmail, variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const unlinkMut = trpc.personalSalud.unlinkAuthUser.useMutation({
    onSuccess: () => {
      utils.personalSalud.get.invalidate();
      utils.personalSalud.getPacientesReferidos.invalidate();
      setToast({ title: "Cuenta desvinculada", variant: "default" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (personalQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  if (personalQuery.error) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {personalQuery.error.message}
      </p>
    );
  }
  const personal = personalQuery.data;
  if (!personal) return null;

  const referidos = referidosQuery.data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref} aria-label={`Volver a ${backLabel}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-bold">{personal.nombreCompleto}</h1>
          <p className="text-sm text-muted-foreground">
            Doc. {personal.documentoIdentidad}
            {personal.jvpmOJvp ? <> · {personal.jvpmOJvp}</> : null}
            {personal.profesion ? <> · {personal.profesion}</> : null}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {personal.activo ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="outline">Inactivo</Badge>
            )}
            {personal.firmaActiva ? (
              <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100">
                <ShieldCheck className="mr-1 h-3 w-3" aria-hidden /> Firma electrónica activa
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-700">
                <ShieldAlert className="mr-1 h-3 w-3" aria-hidden /> Sin firma electrónica
              </Badge>
            )}
            {personal.authUserId ? (
              <Badge variant="secondary">
                <Link2 className="mr-1 h-3 w-3" aria-hidden /> Cuenta de acceso vinculada
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-700">
                <Unlink className="mr-1 h-3 w-3" aria-hidden /> Sin cuenta de acceso
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="basicos">
        <TabsList>
          <TabsTrigger value="basicos">Datos básicos</TabsTrigger>
          <TabsTrigger value="referidos">
            Pacientes referidos
            {referidos && referidos.pacientes.length > 0 ? (
              <Badge variant="secondary" className="ml-2">
                {referidos.pacientes.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="cuenta">Cuenta de acceso</TabsTrigger>
        </TabsList>

        {/* Tab: Datos básicos */}
        <TabsContent value="basicos" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Información del profesional</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Documento de identidad</dt>
                  <dd className="font-mono">{personal.documentoIdentidad}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">JVPM / JVP / JNR</dt>
                  <dd className="font-mono">{personal.jvpmOJvp ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Profesión</dt>
                  <dd>{personal.profesion ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Alta del registro</dt>
                  <dd>{new Date(personal.creadoEn).toLocaleDateString("es-SV", { day: "numeric", month: "long", year: "numeric" })}</dd>
                </div>
                {personal.fechaBaja && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Fecha de baja</dt>
                    <dd>{new Date(personal.fechaBaja).toLocaleDateString("es-SV", { day: "numeric", month: "long", year: "numeric" })}</dd>
                  </div>
                )}
              </dl>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Roles ECE asignados</p>
                <div className="flex flex-wrap gap-1">
                  {personal.roles.length === 0 ? (
                    <span className="text-sm text-muted-foreground">Sin roles asignados.</span>
                  ) : (
                    personal.roles.map((r) => (
                      <Badge key={r.codigo} variant="secondary">{r.nombre}</Badge>
                    ))
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Para editar datos básicos o roles, vuelva al listado y use el botón "Editar".
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Pacientes referidos (CORE B2B2C) */}
        <TabsContent value="referidos" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pacientes que ha atendido</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {referidosQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Calculando…</p>
              )}
              {referidos && !referidos.authUserLinked && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Sin cuenta de acceso vinculada</p>
                  <p className="text-xs mt-1">
                    No se puede mostrar el listado de pacientes hasta que vincule este
                    profesional con un usuario HIS. Ve a la pestaña{" "}
                    <strong>Cuenta de acceso</strong> para enlazar.
                  </p>
                </div>
              )}
              {referidos && referidos.authUserLinked && referidos.pacientes.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Aún no hay pacientes atendidos por este profesional.
                </p>
              )}
              {referidos && referidos.authUserLinked && referidos.pacientes.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {referidos.pacientes.length} paciente(s) en {referidos.totalEncuentros} encuentro(s) total(es).
                    Última atención de cada paciente con este profesional.
                  </p>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-32">MRN</TableHead>
                          <TableHead>Paciente</TableHead>
                          <TableHead className="text-center w-20">Cirugía</TableHead>
                          <TableHead className="text-center w-20">Hospital.</TableHead>
                          <TableHead className="text-center w-20">Ambulat.</TableHead>
                          <TableHead className="text-center w-20">Emerg.</TableHead>
                          <TableHead className="w-40">Última atención</TableHead>
                          <TableHead className="w-16" aria-label="Acciones" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {referidos.pacientes.map((p) => (
                          <TableRow key={p.patientId}>
                            <TableCell className="font-mono text-xs">{p.mrn}</TableCell>
                            <TableCell>
                              <Link
                                href={`/patients/${p.patientId}`}
                                className="font-medium underline-offset-4 hover:underline"
                              >
                                {p.firstName} {p.lastName}
                              </Link>
                              {p.biologicalSexCode && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  ({p.biologicalSexCode})
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-center tabular-nums">{p.conteos.cirugia || "—"}</TableCell>
                            <TableCell className="text-center tabular-nums">{p.conteos.hospitalizacion || "—"}</TableCell>
                            <TableCell className="text-center tabular-nums">{p.conteos.ambulatorio || "—"}</TableCell>
                            <TableCell className="text-center tabular-nums">{p.conteos.emergencia || "—"}</TableCell>
                            <TableCell className="text-xs">
                              {p.ultimaAtencion
                                ? new Date(p.ultimaAtencion).toLocaleDateString("es-SV", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <Button asChild size="sm" variant="outline">
                                <Link href={`/patients/${p.patientId}`}>Ver</Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Cuenta de acceso */}
        <TabsContent value="cuenta" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cuenta de acceso al sistema</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Para que el profesional pueda iniciar sesión en el HIS, firmar
                documentos electrónicamente y aparecer en reportes de productividad,
                debe estar vinculado con un usuario HIS (correo + roles RBAC).
              </p>
              {personal.authUserId ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-green-300 bg-green-50 p-3">
                    <p className="font-medium text-green-900 flex items-center gap-1">
                      <Link2 className="h-4 w-4" aria-hidden /> Cuenta vinculada
                    </p>
                    <p className="text-xs text-green-700 mt-1 font-mono">
                      User ID: {personal.authUserId}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => unlinkMut.mutate({ personalId })}
                    disabled={unlinkMut.isPending}
                  >
                    <Unlink className="mr-2 h-4 w-4" aria-hidden />
                    {unlinkMut.isPending ? "Desvinculando…" : "Desvincular cuenta"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                    <p className="font-medium text-amber-900">Sin cuenta vinculada</p>
                    <p className="text-xs text-amber-800 mt-1">
                      Vincule con un usuario existente o crea uno nuevo desde{" "}
                      <Link href="/users" className="underline">Administración → Usuarios</Link>{" "}
                      y luego regresa aquí.
                    </p>
                  </div>
                  <Button onClick={() => setLinkOpen(true)}>
                    <Link2 className="mr-2 h-4 w-4" aria-hidden />
                    Vincular cuenta existente
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog: vincular User */}
      <Dialog open={linkOpen} onOpenChange={(o) => !o && setLinkOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular cuenta de acceso</DialogTitle>
            <DialogDescription>
              Busca el usuario HIS por correo o nombre. Solo aparecen los usuarios
              activos que aún no están vinculados a otro profesional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="userSearch">Buscar usuario</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  id="userSearch"
                  value={linkSearch}
                  onChange={(e) => setLinkSearch(e.target.value)}
                  placeholder="Mínimo 2 caracteres…"
                  className="pl-8"
                />
              </div>
            </div>
            <div className="rounded-md border max-h-64 overflow-y-auto">
              {linkSearch.trim().length < 2 ? (
                <p className="text-sm text-muted-foreground p-3 text-center">
                  Escribe al menos 2 caracteres.
                </p>
              ) : userSearchQuery.isLoading ? (
                <p className="text-sm text-muted-foreground p-3 text-center">Buscando…</p>
              ) : (userSearchQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 text-center">
                  Sin resultados disponibles.
                </p>
              ) : (
                <ul className="divide-y">
                  {(userSearchQuery.data ?? []).map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-2 p-2 hover:bg-muted/50">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{u.fullName}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => linkMut.mutate({ personalId, userId: u.id })}
                        disabled={linkMut.isPending}
                      >
                        Vincular
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cerrar
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
