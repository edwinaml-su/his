"use client";

/**
 * US-4.7 — AllergyForm stub.
 *
 * El router `allergy` aún no se cablea en `_app.ts` (ver
 * `apps/web/src/app/(clinical)/patients/[id]/allergies/page.tsx`).
 * Este componente renderiza un Dialog informativo hasta Sprint 4
 * cuando se conecte el mutation real.
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";

export interface AllergyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  editingId?: string;
}

export function AllergyForm({ open, onOpenChange, editingId }: AllergyFormProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingId ? "Editar alergia" : "Registrar alergia"}
          </DialogTitle>
          <DialogDescription>
            El registro de alergias detallado se habilitará al cablearse el
            router en Sprint 4. Por ahora la información persistente vive en
            el modelo Patient y se muestra en la tabla.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
