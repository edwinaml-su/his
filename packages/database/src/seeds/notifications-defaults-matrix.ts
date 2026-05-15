/**
 * Matriz §6 backlog Beta.15 (US.B15.3.4) — defaults `RoleNotificationDefault`.
 *
 * Módulo PURO (sin import de `@prisma/client`) para que los tests unitarios
 * puedan validar la expansión sin arrancar PrismaClient. El script de seed
 * en `packages/database/seed-notifications-defaults.ts` re-exporta y consume
 * estos símbolos.
 *
 * Backlog: docs/backlog/beta15_alerts_notifications.md §6.
 */

/** Severidad clínica/operativa. Espejo del enum `NotificationSeverity` Prisma. */
export type Severity = "CRITICAL" | "WARNING" | "INFO";

/** Canal de entrega. Espejo del enum `NotificationChannel` Prisma. */
export type Channel = "INBOX" | "EMAIL";

/** Códigos de rol contemplados por la matriz §6. */
export type RoleCode = "PHYSICIAN" | "NURSE" | "PHARMACIST" | "ADMIN";

/** Para un rol, qué channels están habilitados por cada severity. */
export interface RoleDefaults {
  CRITICAL: ReadonlyArray<Channel>;
  WARNING: ReadonlyArray<Channel>;
  INFO: ReadonlyArray<Channel>;
}

/**
 * Matriz §6 backlog Beta.15.
 *
 *   PHYSICIAN (Doctor):   CRITICAL→{INBOX,EMAIL}  WARNING→{INBOX,EMAIL}  INFO→{INBOX}
 *   NURSE:                CRITICAL→{INBOX,EMAIL}  WARNING→{INBOX}        INFO→{INBOX}
 *   PHARMACIST:           CRITICAL→{INBOX,EMAIL}  WARNING→{INBOX,EMAIL}  INFO→{INBOX}
 *   ADMIN (Admin Org):    CRITICAL→{INBOX,EMAIL}  WARNING→{INBOX}        INFO→{}
 */
export const MATRIX: Record<RoleCode, RoleDefaults> = {
  PHYSICIAN: {
    CRITICAL: ["INBOX", "EMAIL"],
    WARNING: ["INBOX", "EMAIL"],
    INFO: ["INBOX"],
  },
  NURSE: {
    CRITICAL: ["INBOX", "EMAIL"],
    WARNING: ["INBOX"],
    INFO: ["INBOX"],
  },
  PHARMACIST: {
    CRITICAL: ["INBOX", "EMAIL"],
    WARNING: ["INBOX", "EMAIL"],
    INFO: ["INBOX"],
  },
  ADMIN: {
    CRITICAL: ["INBOX", "EMAIL"],
    WARNING: ["INBOX"],
    INFO: [],
  },
};

export const ALL_SEVERITIES: Severity[] = ["CRITICAL", "WARNING", "INFO"];
export const ALL_CHANNELS: Channel[] = ["INBOX", "EMAIL"];

export const ROLE_CODES: RoleCode[] = ["PHYSICIAN", "NURSE", "PHARMACIST", "ADMIN"];

/**
 * Expande la matriz a la lista plana de filas `(severity, channel, enabled)`
 * para un rol dado. SIEMPRE devuelve 6 filas (3 severities × 2 channels) —
 * los pares deshabilitados se persisten con `enabled = false` para hacer
 * explícito el opt-out (en lugar de ausencia).
 */
export function expandDefaultsForRole(
  roleCode: RoleCode,
): Array<{ severity: Severity; channel: Channel; enabled: boolean }> {
  const def = MATRIX[roleCode];
  const out: Array<{ severity: Severity; channel: Channel; enabled: boolean }> = [];
  for (const severity of ALL_SEVERITIES) {
    const enabledChannels = def[severity];
    for (const channel of ALL_CHANNELS) {
      out.push({
        severity,
        channel,
        enabled: enabledChannels.includes(channel),
      });
    }
  }
  return out;
}
