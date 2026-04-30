"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { Badge } from "./badge";

export type TriageColor = "RED" | "ORANGE" | "YELLOW" | "GREEN" | "BLUE";

interface TriageWidgetProps {
  color: TriageColor;
  levelName: string;
  /** Inicio del cronómetro (ISO o Date). Si no hay valor, no muestra reloj. */
  startedAt?: Date | string | null;
  /** Tope (en minutos) según el nivel. Cuando lo supere, marca crítico. */
  maxWaitMinutes?: number;
  className?: string;
}

const COLOR_VARIANT: Record<TriageColor, "triageRed" | "triageOrange" | "triageYellow" | "triageGreen" | "triageBlue"> = {
  RED: "triageRed",
  ORANGE: "triageOrange",
  YELLOW: "triageYellow",
  GREEN: "triageGreen",
  BLUE: "triageBlue",
};

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Badge + cronómetro Manchester (TDR §9). Si supera maxWaitMinutes, resalta crítico.
 */
export function TriageWidget({
  color,
  levelName,
  startedAt,
  maxWaitMinutes,
  className,
}: TriageWidgetProps) {
  const start = startedAt ? new Date(startedAt) : null;
  const [now, setNow] = React.useState<Date>(() => new Date());

  React.useEffect(() => {
    if (!start) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [start]);

  const elapsedMs = start ? now.getTime() - start.getTime() : 0;
  const overdue =
    !!start && typeof maxWaitMinutes === "number" && elapsedMs > maxWaitMinutes * 60_000;

  return (
    <div
      className={cn("flex items-center gap-2", overdue && "animate-critical-pulse", className)}
      role="status"
      aria-live="polite"
    >
      <Badge variant={COLOR_VARIANT[color]} className="uppercase">
        {levelName}
      </Badge>
      {start && (
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs font-mono tabular-nums",
            overdue ? "border-destructive text-destructive" : "border-border text-muted-foreground",
          )}
        >
          {formatElapsed(elapsedMs)}
        </span>
      )}
    </div>
  );
}
