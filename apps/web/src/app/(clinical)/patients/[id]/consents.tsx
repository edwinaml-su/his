"use client";

/**
 * US-2.9 — Sub-componente: consentimientos del paciente en la vista 360°.
 *
 * Muestra resumen ("X vigentes, Y revocados") y lista expandible con
 * el detalle de cada consentimiento (propósito, vigencia, firmante).
 *
 * Importable desde `page.tsx` del paciente cuando se añada el tab "Consentimientos"
 * (TODO Sprint 2: integrar al Tabs principal del paciente).
 */
import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

type Status = "active" | "revoked" | "expired";

const PURPOSE_LABEL: Record<string, string> = {
  "data-processing": "Tratamiento de datos",
  "mpi-cross-org": "Compartir entre estab.",
  transfusion: "Transfusión",
  research: "Investigación",
  telemedicine: "Telemedicina",
};

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive"> = {
  active: "default",
  revoked: "destructive",
  expired: "secondary",
};

const STATUS_LABEL: Record<Status, string> = {
  active: "Vigente",
  revoked: "Revocado",
  expired: "Expirado",
};

export interface PatientConsentsProps {
  patientId: string;
}

export function PatientConsents({ patientId }: PatientConsentsProps) {
  const [open, setOpen] = React.useState(false);
  const query = trpc.consent.byPatient.useQuery({ patientId });
  const utils = trpc.useUtils();
  const revoke = trpc.consent.revoke.useMutation({
    onSuccess: () => utils.consent.byPatient.invalidate({ patientId }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consentimientos</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        )}
        {query.error && (
          <p className="text-sm text-destructive">{query.error.message}</p>
        )}
        {query.data && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                <span className="font-bold">{query.data.summary.active}</span>{" "}
                vigentes,{" "}
                <span className="font-bold">{query.data.summary.revoked}</span>{" "}
                revocados
                {query.data.summary.expired > 0 && (
                  <>
                    ,{" "}
                    <span className="font-bold">
                      {query.data.summary.expired}
                    </span>{" "}
                    expirados
                  </>
                )}
                .
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
              >
                {open ? "Ocultar detalle" : "Ver detalle"}
              </Button>
            </div>

            {open && (
              <div className="mt-4 space-y-3">
              {query.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  El paciente aún no tiene consentimientos registrados.
                </p>
              ) : (
                <ul className="space-y-2">
                  {query.data.items.map((c) => {
                    const s = c.status as Status;
                    return (
                      <li
                        key={c.id}
                        className="rounded-md border p-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">
                              {PURPOSE_LABEL[c.purpose] ?? c.purpose}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Firmado el{" "}
                              {new Date(c.signedAt).toLocaleString("es-SV")}
                              {c.signedBy?.fullName && (
                                <> por {c.signedBy.fullName}</>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={STATUS_VARIANT[s]}>
                              {STATUS_LABEL[s]}
                            </Badge>
                            {s === "active" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={revoke.isPending}
                                onClick={() => {
                                  if (
                                    confirm(
                                      "¿Revocar este consentimiento? La acción es inmutable.",
                                    )
                                  ) {
                                    revoke.mutate({ id: c.id });
                                  }
                                }}
                              >
                                Revocar
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Vigencia:{" "}
                          {new Date(c.validFrom).toLocaleDateString("es-SV")}
                          {" → "}
                          {c.validTo
                            ? new Date(c.validTo).toLocaleDateString("es-SV")
                            : "indef."}
                          {c.revokedAt && (
                            <>
                              {" · Revocado el "}
                              {new Date(c.revokedAt).toLocaleString("es-SV")}
                            </>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PatientConsents;
