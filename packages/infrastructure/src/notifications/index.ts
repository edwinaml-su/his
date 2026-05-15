/**
 * Barrel del paquete de notificaciones — Beta.15 (US.B15.2.3).
 *
 * Re-exporta los símbolos públicos del dispatcher, las routing rules y las
 * plantillas. La interface `EmailProvider` (canónica en `@his/contracts`
 * desde Track A / PR #58) se re-exporta para que callers tengan un único
 * entry-point estable.
 */
export {
  dispatchDomainEvent,
  type DispatchContext,
  type DispatchInputEvent,
  type DispatchResult,
  type DispatcherPrisma,
} from "./dispatcher";

export {
  resolveChannels,
  ROLE_CODES,
  DEFAULT_ROLE_DEFAULTS,
  FALLBACK_DEFAULTS,
  type Channel,
  type ChannelSet,
  type RoleCode,
  type RoleSeverityMatrix,
  type Severity,
} from "./routing";

export {
  buildVitalCriticalTemplate,
  buildLabCriticalValueTemplate,
  buildDrugInteractionTemplate,
  buildAllergyMismatchTemplate,
  type RenderedTemplate,
  type TemplateContext,
} from "./templates";

export {
  PermanentProviderError,
  TransientProviderError,
  type EmailProvider,
  type EmailSendInput,
  type EmailSendResult,
} from "@his/contracts";
