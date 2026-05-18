"use client";

/**
 * Hook de permisos ECE para componentes client-side.
 *
 * Uso: los Server Components resuelven el tenant (roleCodes) y lo pasan
 * como prop a los Client Components. El hook deriva el mapa de permisos
 * memoizado para ocultar/deshabilitar controles según el rol.
 *
 * Ejemplo:
 *   // Server Component
 *   const tenant = await getTenantContext();
 *   return <CertificarButton roleCodes={tenant?.roleCodes ?? []} />;
 *
 *   // Client Component
 *   const { canCertificar } = useEcePermissions(roleCodes);
 *   if (!canCertificar) return null;
 */
import { useMemo } from "react";
import { hasEcePermission, type EcePermission } from "@/lib/auth/ece-permissions";

export interface EcePermissions {
  canFirmar: boolean;
  canValidar: boolean;
  canCertificar: boolean;
  canAnular: boolean;
  canReadBitacora: boolean;
  canSolicitarRectificacion: boolean;
  canAprobarRectificacion: boolean;
  canDesignWorkflow: boolean;
  // Shortcuts quirúrgicos / obstétricos / neonatales (75_specialized_roles.sql)
  canProgramarCirugia: boolean;
  canFirmarActoQx: boolean;
  canAdministrarAnestesia: boolean;
  canDarAltaUrpa: boolean;
  canRegistrarPartograma: boolean;
  canFirmarRN: boolean;
  canEjecutarReanimacion: boolean;
  /** Helper genérico para permisos no cubiertos por los atajos de arriba. */
  can: (permission: EcePermission) => boolean;
}

export function useEcePermissions(roleCodes: readonly string[]): EcePermissions {
  return useMemo(() => {
    const ctx = { roleCodes };
    const can = (p: EcePermission) => hasEcePermission(p, ctx);

    return {
      canFirmar:                 can("ece.documento.firmar"),
      canValidar:                can("ece.documento.validar"),
      canCertificar:             can("ece.documento.certificar"),
      canAnular:                 can("ece.documento.anular"),
      canReadBitacora:           can("ece.bitacora.read"),
      canSolicitarRectificacion: can("ece.rectificacion.solicitar"),
      canAprobarRectificacion:   can("ece.rectificacion.aprobar"),
      canDesignWorkflow:         can("ece.workflow.designer"),
      canProgramarCirugia:       can("ece.cirugia.programar"),
      canFirmarActoQx:           can("ece.cirugia.firmar_acto"),
      canAdministrarAnestesia:   can("ece.anestesia.administrar"),
      canDarAltaUrpa:            can("ece.urpa.dar_alta"),
      canRegistrarPartograma:    can("ece.partograma.registrar"),
      canFirmarRN:               can("ece.rn.firmar"),
      canEjecutarReanimacion:    can("ece.reanimacion.ejecutar"),
      can,
    };
  }, [roleCodes]);
}
