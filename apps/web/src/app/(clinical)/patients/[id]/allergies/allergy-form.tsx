"use client";

// Stub — falta implementación completa del form. Sólo destrabar typecheck.
// TODO Sprint 4: dialog real con upsert vía allergy router (no wireado aún).
import * as React from "react";

interface AllergyFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  editingId?: string | undefined;
}

export function AllergyForm(_props: AllergyFormProps): React.ReactElement | null {
  return null;
}
