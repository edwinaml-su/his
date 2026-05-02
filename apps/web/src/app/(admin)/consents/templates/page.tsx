"use client";

/**
 * US-2.9 — Visor de plantillas de consentimiento (read-only en MVP).
 *
 * Las plantillas están hardcoded en `consent.router.ts` (constants).
 * Esta página las consume vía `consent.templates` para que el equipo legal
 * pueda revisarlas y los operadores conozcan la versión vigente al firmar.
 *
 * TODO(Sprint 2): pasar a tabla `ConsentTemplate` y permitir alta/edición
 *                 versionada con publicación controlada por COMPLIANCE_ADMIN.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

const PURPOSE_LABEL: Record<string, string> = {
  "data-processing": "Tratamiento de datos personales",
  "mpi-cross-org": "Compartir entre establecimientos",
  transfusion: "Transfusión sanguínea",
  research: "Investigación clínica",
  telemedicine: "Telemedicina",
};

export default function ConsentTemplatesPage() {
  const [iso, setIso] = React.useState<string>("");
  const [committedIso, setCommittedIso] = React.useState<string | undefined>(undefined);

  const query = trpc.consent.templates.useQuery({ countryIso: committedIso });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Plantillas de consentimiento</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo de plantillas vigentes por país y propósito (MVP — hardcoded).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>País</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setCommittedIso(iso.trim().toUpperCase() || undefined);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="iso">ISO alpha-3 (opcional)</Label>
              <Input
                id="iso"
                value={iso}
                onChange={(e) => setIso(e.target.value)}
                placeholder="SLV, GTM, HND…"
                maxLength={3}
                className="w-[140px] uppercase"
              />
            </div>
            <Button type="submit" variant="outline">Cargar</Button>
            <p className="ml-2 text-xs text-muted-foreground">
              Vacío = país del tenant activo.
            </p>
          </form>
        </CardContent>
      </Card>

      {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {query.error && <p className="text-sm text-destructive">{query.error.message}</p>}

      {query.data && (
        <div className="space-y-3">
          <p className="text-sm">
            País: <span className="font-mono font-bold">{query.data.countryIso}</span>{" "}
            <Badge variant="secondary">{query.data.templates.length} plantillas</Badge>
          </p>

          {query.data.templates.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground">
                No hay plantillas registradas para este país. Configura
                CONSENT_TEMPLATES en consent.router.ts.
              </CardContent>
            </Card>
          ) : (
            query.data.templates.map((tpl) => (
              <Card key={tpl.purpose}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {PURPOSE_LABEL[tpl.purpose] ?? tpl.purpose}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Badge variant="outline">v{tpl.version}</Badge>
                      <Badge variant="secondary">
                        {tpl.validForDays
                          ? `Válido ${tpl.validForDays} días`
                          : "Indefinido"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm font-medium">{tpl.title}</p>
                  <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                    {tpl.text}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
