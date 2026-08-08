/**
 * CC-0017 F2 — tipos runtime del motor ABAC.
 *
 * `AbacAtributosRuntime` es lo que el caller (abacGuard u otro código
 * server-side) arma para UNA decisión concreta; `AbacRuleRuntime` es la forma
 * ya parseada (condiciones tipadas) de una fila `AbacRule` cargada de BD.
 */
import type { AbacAccion, AbacCondicion, AbacEffect, AbacRecurso } from "@his/contracts";

export interface AbacAtributosRuntime {
  /** Códigos de rol efectivos del usuario en la organización activa. */
  rol: string[];
  /** Establecimiento (sede) activo del tenant. */
  establecimiento?: string;
  /**
   * Código(s) de ServiceUnit relevantes para esta decisión. Por defecto
   * (`atributosDesdeContexto`) son las asignaciones Nivel A del usuario;
   * el caller puede sobreescribir con el ServiceUnit específico del recurso.
   */
  servicio?: string[];
  /** Hora actual "HH:MM" (24h, America/El_Salvador). Se calcula por defecto. */
  horaActual?: string;
  /** ¿El paciente objetivo tiene un encounter con triage activo? La provee el caller. */
  pacienteConTriaje?: boolean;
  /** ¿El usuario está activo? Default true — ver nota en `atributosDesdeContexto`. */
  usuarioActivo?: boolean;
  /** ¿El recurso pertenece al propio usuario que lo solicita? La provee el caller. */
  esPropioPaciente?: boolean;
}

/** Fila `AbacRule` con `condiciones` ya parseadas/tipadas (post safeParse). */
export interface AbacRuleRuntime {
  id: string;
  recurso: AbacRecurso;
  accion: AbacAccion;
  effect: AbacEffect;
  prioridad: number;
  descripcion: string | null;
  condiciones: AbacCondicion[];
  active: boolean;
}
