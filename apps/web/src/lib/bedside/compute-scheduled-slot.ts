/**
 * Re-export de computeScheduledSlot para componentes del dominio bedside.
 *
 * La implementación vive en @/lib/medication-slot para mantener paridad con
 * el port server-side en packages/trpc/src/utils/medication-slot.ts.
 * Este barrel evita que los componentes bedside importen desde una ruta
 * que semánticamente no les pertenece.
 */
export { computeScheduledSlot } from "@/lib/medication-slot";
