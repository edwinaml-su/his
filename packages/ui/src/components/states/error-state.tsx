import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../button";

export interface ErrorStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title?: string;
  description?: string;
  retry?: () => void;
  className?: string;
}

export function ErrorState({
  icon: Icon = AlertCircle,
  title = "Algo salió mal",
  description,
  retry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-destructive/10">
        <Icon className="h-6 w-6 text-destructive" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {retry ? (
        <Button variant="outline" onClick={retry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}
