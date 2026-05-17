"use client";

/**
 * Certificación DIR — Art. 21 NTEC.
 *
 * Solo visible y accesible para usuarios con rol DIR.
 * Lista los documentos en estado 'validado' que esperan certificación formal.
 * Permite certificar con PIN y ver el histórico de documentos ya certificados.
 */
import * as React from "react";
import Link from "next/link";
import { Shield, ClipboardCheck } from "lucide-react";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Skeleton } from "@his/ui/components/skeleton";
import { Switch } from "@his/ui/components/switch";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

type DocumentoItem = {
  id: string;
  tipoDocumentoCodigo: string;
  tipoDocumentoNombre: string;
  pacienteId: string;
  pacienteNombre: string;
  estadoCodigo: string;
  estadoNombre: string;
  version: number;
  validadoPor: string | null;
  validadoPorNombre: string | null;
  creadoEn: string;
  ultimoCambioEn: string;
};

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export default function CertificacionDirPage() {
  const [incluirCertificados, setIncluirCertificados] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedDoc, setSelectedDoc] = React.useState<DocumentoItem | null>(null);
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState<string | null>(null);

  const colaQuery = trpc.eceCertificacion.listCola.useQuery({ incluirCertificados });

  const certificarMutation = trpc.eceCertificacion.certificar.useMutation({
    onSuccess: () => {
      setDialogOpen(false);
      setPin("");
      setPinError(null);
      colaQuery.refetch();
    },
    onError: (err: { message: string }) => {
      setPinError(err.message ?? "Error al certificar. Verifique su PIN.");
    },
  });

  const documentos: DocumentoItem[] = colaQuery.data?.items ?? [];

  function handleAbrirCertificar(doc: DocumentoItem) {
    setSelectedDoc(doc);
    setPin("");
    setPinError(null);
    setDialogOpen(true);
  }

  function handleCerrarDialog() {
    if (certificarMutation.isPending) return;
    setDialogOpen(false);
    setPin("");
    setPinError(null);
  }

  function handleCertificar() {
    if (!selectedDoc) return;
    if (!/^\d{6,8}$/.test(pin)) {
      setPinError("El PIN debe tener entre 6 y 8 dígitos numéricos.");
      return;
    }
    setPinError(null);
    certificarMutation.mutate({ instanciaId: selectedDoc.id, pin });
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Shield className="h-6 w-6 text-primary" aria-hidden="true" />
            Certificación DIR
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Certificación formal de copias de FICHA_ID, EPICRISIS y CERT_DEF — Art. 21 NTEC.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Label htmlFor="toggle-certificados" className="text-sm">
            Mostrar ya certificados
          </Label>
          <Switch
            id="toggle-certificados"
            checked={incluirCertificados}
            onCheckedChange={setIncluirCertificados}
            aria-label="Mostrar documentos ya certificados"
          />
        </div>
      </div>

      {/* Error de carga */}
      {colaQuery.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {String(colaQuery.error.message)}
        </div>
      )}

      {/* Cola de documentos */}
      {colaQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      ) : documentos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <ClipboardCheck className="mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
          <p className="font-medium">Sin documentos pendientes</p>
          <p className="text-sm">
            {incluirCertificados
              ? "No hay documentos certificados en este establecimiento."
              : "No hay documentos en estado 'validado' para certificar."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documentos.map((doc) => (
            <DocumentoCard
              key={doc.id}
              doc={doc}
              onCertificar={handleAbrirCertificar}
            />
          ))}
        </div>
      )}

      {/* Modal de firma PIN */}
      <Dialog open={dialogOpen} onOpenChange={handleCerrarDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Certificar documento</DialogTitle>
            <DialogDescription>
              Ingrese su PIN de firma electrónica para certificar formalmente este documento
              (Art. 21 NTEC). Esta acción es irreversible.
            </DialogDescription>
          </DialogHeader>

          {selectedDoc && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p>
                <span className="font-medium">Tipo:</span>{" "}
                {selectedDoc.tipoDocumentoNombre} ({selectedDoc.tipoDocumentoCodigo})
              </p>
              <p>
                <span className="font-medium">Paciente:</span> {selectedDoc.pacienteNombre}
              </p>
              {selectedDoc.validadoPorNombre && (
                <p>
                  <span className="font-medium">Validado por:</span>{" "}
                  {selectedDoc.validadoPorNombre}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="pin-firma">PIN de firma DIR</Label>
            <Input
              id="pin-firma"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setPinError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCertificar();
              }}
              placeholder="6-8 dígitos"
              aria-describedby={pinError ? "pin-error" : undefined}
              aria-invalid={pinError ? true : undefined}
              disabled={certificarMutation.isPending}
              autoComplete="current-password"
            />
            {pinError && (
              <p id="pin-error" role="alert" className="text-sm text-destructive">
                {pinError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCerrarDialog}
              disabled={certificarMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCertificar}
              disabled={pin.length < 6 || certificarMutation.isPending}
              aria-busy={certificarMutation.isPending}
            >
              {certificarMutation.isPending ? "Certificando…" : "Certificar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card de documento
// ---------------------------------------------------------------------------

function DocumentoCard({
  doc,
  onCertificar,
}: {
  doc: DocumentoItem;
  onCertificar: (doc: DocumentoItem) => void;
}) {
  const yaCertificado = doc.estadoCodigo === "certificado";

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">
            {doc.tipoDocumentoNombre}
          </CardTitle>
          {yaCertificado ? (
            <Badge variant="success" className="shrink-0">Certificado</Badge>
          ) : (
            <Badge variant="warning" className="shrink-0">Pendiente</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-2 text-sm">
        <p>
          <span className="text-muted-foreground">Paciente:</span>{" "}
          <span className="font-medium">{doc.pacienteNombre}</span>
        </p>

        {doc.validadoPorNombre && (
          <p>
            <span className="text-muted-foreground">Validado por:</span>{" "}
            {doc.validadoPorNombre}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Creado: {new Date(doc.creadoEn).toLocaleDateString("es-SV")}
          {" — "}
          v{doc.version}
        </p>

        <div className="mt-auto flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            asChild
          >
            <Link href={`/ece/instancias/${doc.id}`}>
              Ver documento
            </Link>
          </Button>

          {!yaCertificado && (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onCertificar(doc)}
            >
              Certificar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
