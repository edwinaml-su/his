"use client";

/**
 * Tarjeta de signos vitales a nivel de evolución (D-B, CC-0004).
 *
 * Los signos son únicos por evolución (un signosVitalesId por registro);
 * se capturan aquí, fuera del modal de problema.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  SignosVitalesCapture,
  type SignosState,
} from "./SignosVitalesCapture";

interface SignosVitalesCardProps {
  value: SignosState;
  onChange: (s: SignosState) => void;
}

export function SignosVitalesCard({ value, onChange }: SignosVitalesCardProps) {
  return (
    <Card className="border-l-4 border-green-300 dark:border-green-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide">
          Signos vitales
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Opcional — registre si tomó signos en esta evaluación.
        </p>
      </CardHeader>
      <CardContent>
        <SignosVitalesCapture
          idPrefix="evol-sv"
          value={value}
          onChange={onChange}
        />
      </CardContent>
    </Card>
  );
}
