"use client";

/**
 * US-1.4 — Política de redondeo por libro (STUB Sprint 5).
 *
 * Lee `ledger.roundingPolicy(ledgerId)` que en MVP devuelve `{decimals: 2,
 * mode: 'HALF_EVEN'}`. La UI muestra los valores como readonly + nota
 * explicando que la persistencia llegará con la tabla `LedgerRoundingPolicy`.
 *
 * Cuando la tabla exista (Sprint 5), este form pasará a ser un Form editable
 * que invoque `ledger.updateRoundingPolicy`. La interfaz permanece estable.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

const ROUNDING_MODES = [
  { value: "HALF_EVEN", label: "Half Even (banker's rounding)" },
  { value: "HALF_UP", label: "Half Up" },
  { value: "HALF_DOWN", label: "Half Down" },
  { value: "DOWN", label: "Truncar (Down)" },
  { value: "UP", label: "Up" },
];

interface RoundingPolicyFormProps {
  ledgerId: string;
}

export function RoundingPolicyForm({ ledgerId }: RoundingPolicyFormProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const query = trpcAny.ledger.roundingPolicy.useQuery({ ledgerId });

  const policy = query.data as
    | {
        ledgerId: string;
        currencyId: string;
        decimals: number;
        mode: string;
        isStub: boolean;
        note: string;
      }
    | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Política de redondeo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {policy?.isStub ? (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="warning">Stub MVP</Badge>
              <span className="font-medium">Política por defecto</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{policy.note}</p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="decimals">Decimales</Label>
            <Input
              id="decimals"
              type="number"
              value={policy?.decimals ?? 2}
              readOnly
              disabled
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mode">Modo de redondeo</Label>
            <Select value={policy?.mode ?? "HALF_EVEN"} disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUNDING_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" disabled title="Disponible en Sprint 5">
            Guardar cambios — Sprint 5
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          La edición de la política de redondeo (decimales y modo IEEE-754 / IFRS)
          se implementará con la tabla <code>LedgerRoundingPolicy</code> en Sprint 5,
          que permitirá overrides por moneda dentro del mismo libro.
        </p>
      </CardContent>
    </Card>
  );
}
