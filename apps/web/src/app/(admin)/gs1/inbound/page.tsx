"use client";

/**
 * GS1 Logística — Proceso A: Inbound (Recepción de mercancía en muelle).
 *
 * Flujo:
 *   1. Operador escanea SSCC del pallet (campo de texto / lectura de scanner HID).
 *   2. Escanea cada producto (GTIN + lote + vencimiento).
 *   3. Confirma verificación de los 5 correctos logísticos.
 *   4. Registra la recepción → estado: pendiente.
 *   5. Supervisor puede verificar o rechazar la recepción pendiente.
 */
import * as React from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { Textarea } from "@his/ui/components/textarea";
import { Checkbox } from "@his/ui/components/checkbox";
import { trpc } from "@/lib/trpc/react";
import { recibirMercanciaInput } from "@his/contracts";

// ---------------------------------------------------------------------------
// Tipos derivados del schema
// ---------------------------------------------------------------------------
type FormValues = z.infer<typeof recibirMercanciaInput>;

// La UI necesita establecimiento_id y registrado_por que vendrían del contexto
// de sesión. Para MVP: el usuario los ingresa manualmente hasta que se integre
// con el contexto ECE real.
const formSchema = recibirMercanciaInput;

// ---------------------------------------------------------------------------
// Subcomponente: fila de producto
// ---------------------------------------------------------------------------
function ProductoRow({
  index,
  onRemove,
  register,
  errors,
}: {
  index: number;
  onRemove: () => void;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  errors: ReturnType<typeof useForm<FormValues>>["formState"]["errors"];
}) {
  const prodErrors = errors.productos?.[index];
  return (
    <TableRow>
      <TableCell>
        <Input
          {...register(`productos.${index}.gtin`)}
          placeholder="14 dígitos"
          className="font-mono w-40"
          maxLength={14}
          aria-label={`GTIN producto ${index + 1}`}
          aria-invalid={!!prodErrors?.gtin}
        />
        {prodErrors?.gtin && (
          <p className="text-xs text-destructive mt-1">{prodErrors.gtin.message}</p>
        )}
      </TableCell>
      <TableCell>
        <Input
          {...register(`productos.${index}.cantidad`, { valueAsNumber: true })}
          type="number"
          min={1}
          className="w-20"
          aria-label={`Cantidad producto ${index + 1}`}
          aria-invalid={!!prodErrors?.cantidad}
        />
      </TableCell>
      <TableCell>
        <Input
          {...register(`productos.${index}.lote`)}
          placeholder="Lote"
          className="w-28"
          aria-label={`Lote producto ${index + 1}`}
          aria-invalid={!!prodErrors?.lote}
        />
      </TableCell>
      <TableCell>
        <Input
          {...register(`productos.${index}.expiry`)}
          type="date"
          aria-label={`Vencimiento producto ${index + 1}`}
          aria-invalid={!!prodErrors?.expiry}
        />
        {prodErrors?.expiry && (
          <p className="text-xs text-destructive mt-1">{prodErrors.expiry.message}</p>
        )}
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Eliminar producto ${index + 1}`}
        >
          Quitar
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Subcomponente: badge de estado
// ---------------------------------------------------------------------------
function EstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, "default" | "secondary" | "destructive"> = {
    pendiente: "secondary",
    verificado: "default",
    rechazado: "destructive",
  };
  return <Badge variant={map[estado] ?? "secondary"}>{estado}</Badge>;
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function Gs1InboundPage() {
  const [establecimientoId, setEstablecimientoId] = React.useState("");
  const [registradoPor, setRegistradoPor] = React.useState("");
  const [rechazandoId, setRechazandoId] = React.useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = React.useState("");
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitOk, setSubmitOk] = React.useState(false);

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      numero_documento_recepcion: "",
      proveedor_gln: "",
      sscc_pallet: "",
      productos: [{ gtin: "", cantidad: 1, lote: "", expiry: "" }],
      verificacion_5correctos: {
        paciente_n_a: true,
        medicamento_verif: false,
        dosis_n_a: true,
        via_n_a: true,
        hora_n_a: true,
      },
      establecimiento_id: "",
      registrado_por: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "productos",
  });

  // ---------------------------------------------------------------------------
  // tRPC
  // ---------------------------------------------------------------------------
  const recibirMut = trpc.gs1ProcesoA.recibirMercancia.useMutation();
  const rechazarMut = trpc.gs1ProcesoA.rechazar.useMutation();
  const listarQuery = trpc.gs1ProcesoA.listar.useQuery(
    { establecimiento_id: establecimientoId, limit: 50, offset: 0 },
    { enabled: establecimientoId.length === 36 },
  );
  const verificarMut = trpc.gs1ProcesoA.verificar5Correctos.useMutation();

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  async function onSubmit(data: FormValues) {
    setSubmitError(null);
    setSubmitOk(false);
    try {
      await recibirMut.mutateAsync({
        ...data,
        establecimiento_id: establecimientoId,
        registrado_por: registradoPor,
      });
      setSubmitOk(true);
      reset();
      void listarQuery.refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error al registrar recepción.";
      setSubmitError(msg);
    }
  }

  async function handleVerificar(recepcionId: string) {
    await verificarMut.mutateAsync({
      recepcionId,
      verificacion_5correctos: {
        paciente_n_a: true,
        medicamento_verif: true,
        dosis_n_a: true,
        via_n_a: true,
        hora_n_a: true,
      },
    });
    void listarQuery.refetch();
  }

  async function handleRechazar() {
    if (!rechazandoId || motivoRechazo.trim().length < 5) return;
    await rechazarMut.mutateAsync({ recepcionId: rechazandoId, motivo_rechazo: motivoRechazo });
    setRechazandoId(null);
    setMotivoRechazo("");
    void listarQuery.refetch();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">GS1 Inbound — Recepción de mercancía</h1>
        <p className="text-sm text-muted-foreground">
          Proceso A: registra la recepción de pallets en muelle con SSCC y productos GTIN.
        </p>
      </div>

      {/* Contexto de sesión ECE (temporal hasta integración de contexto) */}
      <Card>
        <CardHeader>
          <CardTitle>Contexto ECE</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="establecimiento-id">UUID Establecimiento</Label>
            <Input
              id="establecimiento-id"
              placeholder="UUID del establecimiento"
              value={establecimientoId}
              onChange={(e) => setEstablecimientoId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="registrado-por">UUID Personal (registrado_por)</Label>
            <Input
              id="registrado-por"
              placeholder="UUID de personal de salud"
              value={registradoPor}
              onChange={(e) => setRegistradoPor(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Formulario de nueva recepción */}
      <Card>
        <CardHeader>
          <CardTitle>Nueva recepción</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            {/* Datos del documento */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="num-doc">N° Documento</Label>
                <Input
                  id="num-doc"
                  {...register("numero_documento_recepcion")}
                  placeholder="REC-2026-001"
                  aria-invalid={!!errors.numero_documento_recepcion}
                />
                {errors.numero_documento_recepcion && (
                  <p className="text-xs text-destructive">
                    {errors.numero_documento_recepcion.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proveedor-gln">GLN Proveedor (13 dígitos)</Label>
                <Input
                  id="proveedor-gln"
                  {...register("proveedor_gln")}
                  placeholder="7413000000001"
                  maxLength={13}
                  className="font-mono"
                  aria-invalid={!!errors.proveedor_gln}
                />
                {errors.proveedor_gln && (
                  <p className="text-xs text-destructive">{errors.proveedor_gln.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sscc-pallet">SSCC Pallet (opcional)</Label>
                <Input
                  id="sscc-pallet"
                  {...register("sscc_pallet")}
                  placeholder="374130000000000011"
                  maxLength={18}
                  className="font-mono"
                />
              </div>
            </div>

            {/* Tabla de productos */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium text-sm">Productos escaneados</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ gtin: "", cantidad: 1, lote: "", expiry: "" })}
                >
                  + Agregar producto
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>GTIN</TableHead>
                      <TableHead>Cantidad</TableHead>
                      <TableHead>Lote</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field, i) => (
                      <ProductoRow
                        key={field.id}
                        index={i}
                        onRemove={() => remove(i)}
                        register={register}
                        errors={errors}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
              {errors.productos?.root && (
                <p className="text-xs text-destructive mt-1">
                  {errors.productos.root.message}
                </p>
              )}
            </div>

            {/* Verificación 5 correctos */}
            <Card className="border-dashed">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Verificación de los 5 correctos (muelle)</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-5">
                {(
                  [
                    { key: "paciente_n_a", label: "Paciente N/A", disabled: true },
                    { key: "medicamento_verif", label: "Medicamento verificado", disabled: false },
                    { key: "dosis_n_a", label: "Dosis N/A", disabled: true },
                    { key: "via_n_a", label: "Vía N/A", disabled: true },
                    { key: "hora_n_a", label: "Hora N/A", disabled: true },
                  ] as const
                ).map(({ key, label, disabled }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`5c-${key}`}
                      disabled={disabled}
                      defaultChecked={key !== "medicamento_verif"}
                      {...register(`verificacion_5correctos.${key}`)}
                    />
                    <Label htmlFor={`5c-${key}`} className="text-xs leading-tight">
                      {label}
                    </Label>
                  </div>
                ))}
              </CardContent>
            </Card>

            {submitError && (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            )}
            {submitOk && (
              <p role="status" className="text-sm text-green-600">
                Recepción registrada correctamente.
              </p>
            )}

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Registrando…" : "Registrar recepción"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Tabla de recepciones */}
      {establecimientoId.length === 36 && (
        <Card>
          <CardHeader>
            <CardTitle>Recepciones del establecimiento</CardTitle>
          </CardHeader>
          <CardContent>
            {listarQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            )}
            {listarQuery.error && (
              <p role="alert" className="text-sm text-destructive">
                {listarQuery.error.message}
              </p>
            )}
            {listarQuery.data && listarQuery.data.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin recepciones para este establecimiento.</p>
            )}
            {listarQuery.data && listarQuery.data.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>N° Documento</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>GLN Proveedor</TableHead>
                      <TableHead>SSCC</TableHead>
                      <TableHead>Productos</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listarQuery.data.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">
                          {r.numero_documento_recepcion}
                        </TableCell>
                        <TableCell className="text-sm">
                          {new Date(r.fecha).toLocaleDateString("es-SV")}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {r.proveedor_gln}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.sscc_pallet ?? "—"}
                        </TableCell>
                        <TableCell>
                          {Array.isArray(r.productos) ? r.productos.length : "—"}
                        </TableCell>
                        <TableCell>
                          <EstadoBadge estado={r.estado} />
                        </TableCell>
                        <TableCell>
                          {r.estado === "pendiente" && (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleVerificar(r.id)}
                                disabled={verificarMut.isPending}
                              >
                                Verificar
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setRechazandoId(r.id)}
                              >
                                Rechazar
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Panel de rechazo */}
      {rechazandoId && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive text-sm">
              Rechazar recepción
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="motivo-rechazo">Motivo del rechazo</Label>
              <Textarea
                id="motivo-rechazo"
                value={motivoRechazo}
                onChange={(e) => setMotivoRechazo(e.target.value)}
                placeholder="Describa el motivo del rechazo (mínimo 5 caracteres)"
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={handleRechazar}
                disabled={motivoRechazo.trim().length < 5 || rechazarMut.isPending}
              >
                {rechazarMut.isPending ? "Rechazando…" : "Confirmar rechazo"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => { setRechazandoId(null); setMotivoRechazo(""); }}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
