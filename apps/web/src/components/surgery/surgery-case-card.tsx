"use client";

/**
 * Tarjeta compacta para SurgeryCase en el listado del día.
 */
import Link from "next/link";
import { Card, CardContent } from "@his/ui/components/card";
import { SurgeryStatusBadge, type SurgeryCaseStatus } from "./surgery-status-badge";

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export interface SurgeryCaseCardData {
  id: string;
  status: SurgeryCaseStatus;
  procedureDescription: string;
  scheduledStart: Date | string;
  scheduledEnd: Date | string;
  patient: { firstName: string; lastName: string; mrn: string } | null;
  primarySurgeon: { fullName: string } | null;
  operatingRoom: { code: string; name: string } | null;
}

interface Props {
  surgeryCase: SurgeryCaseCardData;
}

export function SurgeryCaseCard({ surgeryCase: c }: Props) {
  const patientName = c.patient
    ? `${c.patient.firstName} ${c.patient.lastName}`
    : "—";
  const mrn = c.patient?.mrn ?? "";
  const surgeonName = c.primarySurgeon?.fullName ?? "—";
  const orLabel = c.operatingRoom
    ? `${c.operatingRoom.code} — ${c.operatingRoom.name}`
    : "Sin quirófano asignado";

  const start = new Date(c.scheduledStart);
  const end = new Date(c.scheduledEnd);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold truncate">{patientName}</span>
              {mrn && (
                <span className="text-xs text-muted-foreground">MRN: {mrn}</span>
              )}
              <SurgeryStatusBadge status={c.status} />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 truncate">
              {c.procedureDescription}
            </p>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span>{dateFmt.format(start)} – {dateFmt.format(end)}</span>
              <span>{orLabel}</span>
              <span>Cir.: {surgeonName}</span>
            </div>
          </div>
          <Link
            href={`/surgery/${c.id}`}
            className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline"
            aria-label={`Ver detalle de caso quirúrgico de ${patientName}`}
          >
            Ver
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
