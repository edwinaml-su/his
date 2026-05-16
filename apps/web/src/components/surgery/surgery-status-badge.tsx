"use client";

/**
 * Badge de estado para SurgeryCase.
 * Mapea SurgeryCaseStatus → variante visual del Badge del design system.
 */
import { Badge, type BadgeProps } from "@his/ui/components/badge";

export type SurgeryCaseStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "POST_OP"
  | "COMPLETED"
  | "CANCELLED"
  | "POSTPONED";

interface StatusConfig {
  label: string;
  variant: BadgeProps["variant"];
}

const STATUS_MAP: Record<SurgeryCaseStatus, StatusConfig> = {
  SCHEDULED:   { label: "Programado",  variant: "secondary" },
  CONFIRMED:   { label: "Confirmado",  variant: "info" },
  IN_PROGRESS: { label: "En curso",    variant: "warning" },
  POST_OP:     { label: "Post-op",     variant: "info" },
  COMPLETED:   { label: "Completado",  variant: "success" },
  CANCELLED:   { label: "Cancelado",   variant: "destructive" },
  POSTPONED:   { label: "Pospuesto",   variant: "outline" },
};

export function getSurgeryStatusConfig(status: SurgeryCaseStatus): StatusConfig {
  return STATUS_MAP[status] ?? { label: status, variant: "outline" };
}

interface Props {
  status: SurgeryCaseStatus;
  className?: string;
}

export function SurgeryStatusBadge({ status, className }: Props) {
  const { label, variant } = getSurgeryStatusConfig(status);
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
