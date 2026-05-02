/**
 * Session policy — US-2.6 (Sprint 1, MVP).
 *
 * Constantes de timeout idle + helpers de formateo. El componente Client
 * `<IdleMonitor>` consume estas constantes; mantenerlas aquí en un módulo
 * server-safe (sin "use client") permite también importarlas desde Server
 * Actions o tests sin penalty de bundle del lado servidor.
 *
 * Política Avante (MVP, hardcoded):
 *   - Idle timeout: 15 minutos sin actividad => signOut().
 *   - Warning: 1 minuto antes mostrar dialog "Tu sesión expirará en 1 minuto"
 *     con CTA "Continuar sesión" que resetea el timer.
 *
 * TODO(Sprint 2): mover a tabla `SessionPolicy` parametrizable por país /
 * organización. Ver `@his/contracts/schemas/session#sessionPolicySchema`
 * (a definir en S2) — la forma del schema ya está prevista en este sprint
 * en `IdleConfig`.
 *
 * NOTA: la revocación server-side (admin "cerrar todas las sesiones de X")
 * vive en `app/actions/revoke-session.ts` como stub. La integración real con
 * Supabase Admin API (`auth.admin.signOut`) queda para Sprint 2.
 */

/** Minutos sin actividad antes de cerrar sesión automáticamente. */
export const IDLE_TIMEOUT_MINUTES = 15;

/**
 * Minutos antes del logout en que aparece el dialog de aviso.
 * Debe ser estrictamente menor que IDLE_TIMEOUT_MINUTES.
 */
export const WARNING_BEFORE_LOGOUT_MINUTES = 1;

/** Idle total en milisegundos (15 min). */
export const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60 * 1000;

/** Tiempo (ms) entre el warning dialog y el logout efectivo (1 min). */
export const WARNING_BEFORE_LOGOUT_MS = WARNING_BEFORE_LOGOUT_MINUTES * 60 * 1000;

/**
 * Throttle de los listeners de actividad. Evita resetear el timer en cada
 * pixel del mousemove; 5s es suficiente para detectar interacción real
 * sin spam de timers.
 */
export const ACTIVITY_THROTTLE_MS = 5_000;

/**
 * Eventos DOM que cuentan como "actividad del usuario". Mantener corto:
 * añadir más eventos no mejora UX y sí incrementa carga.
 */
export const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll"] as const;

/**
 * Querystring usado al redirigir tras idle logout. La página /login lo lee
 * para mostrar un toast "Tu sesión cerró por inactividad".
 */
export const IDLE_LOGOUT_REASON = "idle";

/**
 * Formatea milisegundos restantes como `m:ss`. Usado por el dialog de
 * warning para el countdown ("Tu sesión expirará en 0:42").
 *
 * - Trunca a 0 negativos (no mostramos "-:01" si el timer se atrasa un tick).
 * - Padding de segundos a 2 dígitos.
 */
export function formatRemainingTime(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
