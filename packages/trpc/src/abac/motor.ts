/**
 * CC-0017 F2 — motor de evaluación ABAC.
 *
 * `evaluarCondiciones` y `resolverDecision` son funciones PURAS (sin BD) —
 * testeables sin mocks. `evaluarAbac` es la única función que toca BD: carga
 * las `AbacRule` activas del tenant para (recurso, accion) vía
 * `withTenantContext` (RLS demote, patrón obligatorio del proyecto) y delega
 * a `resolverDecision`.
 *
 * Precedencia (fail-safe, documentado en docs/CC/0017/REQ-SEC-ABAC-002-*.md):
 *   1. Sin reglas que matcheen → ALLOW ("fail-safe-allow"). El default de
 *      ausencia de configuración NUNCA bloquea — igual que F1.
 *   2. Si ≥1 regla matcheada tiene effect=DENY → DENY. DENY gana siempre
 *      sobre ALLOW, sin importar prioridad.
 *   3. Entre reglas del mismo effect, se reporta como `matchedRuleId` la de
 *      mayor `prioridad` (desempate: la primera cargada).
 *
 * Cache: NO se implementa cache entre requests — cada llamada hace una sola
 * query indexada (organizationId, recurso, accion, active). Cachear por
 * request añadiría una capa de invalidación (¿qué pasa si /abac edita una
 * regla mid-request?) para un ahorro marginal en el PoC de 3 procedures;
 * se deja documentado como posible optimización cuando el enforcement se
 * expanda a más recursos (fuera de alcance F2).
 */
import type { PrismaClient } from "@prisma/client";
import type { TenantContext, AbacAccion, AbacCondicion, AbacDecision, AbacRecurso } from "@his/contracts";
import { abacCondicionSchema } from "@his/contracts";
import { withTenantContext } from "../rls-context";
import type { AbacAtributosRuntime, AbacRuleRuntime } from "./types";

const FAIL_SAFE_ALLOW: AbacDecision = {
  allowed: true,
  matchedRuleId: "fail-safe-allow",
  reason: "Sin regla ABAC aplicable para este recurso/acción — ALLOW fail-safe.",
};

// -----------------------------------------------------------------------------
// Comparadores de atributos (puros)
// -----------------------------------------------------------------------------

function toMinutosDelDia(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Soporta rangos que cruzan medianoche (ej. desde=22:00 hasta=06:00). */
function dentroDeHorario(horaActual: string, desde: string, hasta: string): boolean {
  const cur = toMinutosDelDia(horaActual);
  const ini = toMinutosDelDia(desde);
  const fin = toMinutosDelDia(hasta);
  if (ini <= fin) return cur >= ini && cur <= fin;
  return cur >= ini || cur <= fin;
}

function comoArray(valor: string[] | string): string[] {
  return Array.isArray(valor) ? valor : [valor];
}

/**
 * `"horario"` es el nombre semántico del atributo en las condiciones, pero
 * el valor runtime vive en `atributos.horaActual` (no hay una key literal
 * `horario` en `AbacAtributosRuntime`). Todo lo demás indexa 1:1.
 */
function valorDeAtributo(
  nombre: AbacCondicion["atributo"],
  atributos: AbacAtributosRuntime,
): string[] | string | boolean | undefined {
  if (nombre === "horario") return atributos.horaActual;
  return atributos[nombre];
}

/** Evalúa UN predicado contra los atributos runtime. */
function evaluarCondicion(condicion: AbacCondicion, atributos: AbacAtributosRuntime): boolean {
  const valorAtributo = valorDeAtributo(condicion.atributo, atributos);

  switch (condicion.operador) {
    case "ES_VERDADERO":
      return valorAtributo === true;
    case "ES_FALSO":
      return valorAtributo === false;

    case "ENTRE_HORAS": {
      const horaActual = atributos.horaActual;
      const rango = condicion.valor;
      if (!horaActual || typeof rango !== "object" || Array.isArray(rango) || !("desde" in rango)) {
        return false;
      }
      return dentroDeHorario(horaActual, rango.desde, rango.hasta);
    }

    case "IGUAL":
    case "DIFERENTE": {
      const valorCondicion = condicion.valor;
      let coincide: boolean;
      if (Array.isArray(valorAtributo)) {
        coincide = typeof valorCondicion === "string" && valorAtributo.includes(valorCondicion);
      } else {
        coincide = valorAtributo === valorCondicion;
      }
      return condicion.operador === "IGUAL" ? coincide : !coincide;
    }

    case "EN":
    case "NO_EN": {
      const v = condicion.valor;
      if (typeof v !== "string" && !Array.isArray(v)) {
        // valor no es string ni string[] (ej. objeto horario o boolean) — no aplica.
        return false;
      }
      const permitidos = comoArray(v);
      let coincide: boolean;
      if (Array.isArray(valorAtributo)) {
        coincide = valorAtributo.some((v) => permitidos.includes(v));
      } else if (typeof valorAtributo === "string") {
        coincide = permitidos.includes(valorAtributo);
      } else {
        coincide = false;
      }
      return condicion.operador === "EN" ? coincide : !coincide;
    }

    default:
      return false;
  }
}

/** AND de todos los predicados. Lista vacía = vacuously true (regla incondicional). */
export function evaluarCondiciones(
  condiciones: AbacCondicion[],
  atributos: AbacAtributosRuntime,
): boolean {
  return condiciones.every((c) => evaluarCondicion(c, atributos));
}

// -----------------------------------------------------------------------------
// Resolución de precedencia (puro)
// -----------------------------------------------------------------------------

export function resolverDecision(
  reglas: AbacRuleRuntime[],
  atributos: AbacAtributosRuntime,
): AbacDecision {
  const matcheadas = reglas.filter((r) => r.active && evaluarCondiciones(r.condiciones, atributos));

  if (matcheadas.length === 0) {
    return FAIL_SAFE_ALLOW;
  }

  const porPrioridadDesc = (a: AbacRuleRuntime, b: AbacRuleRuntime) => b.prioridad - a.prioridad;

  const denies = matcheadas.filter((r) => r.effect === "DENY").sort(porPrioridadDesc);
  if (denies.length > 0) {
    const top = denies[0]!;
    return {
      allowed: false,
      matchedRuleId: top.id,
      reason: top.descripcion ?? `DENY por regla ${top.id}.`,
    };
  }

  const allows = matcheadas.filter((r) => r.effect === "ALLOW").sort(porPrioridadDesc);
  const top = allows[0]!;
  return {
    allowed: true,
    matchedRuleId: top.id,
    reason: top.descripcion ?? `ALLOW por regla ${top.id}.`,
  };
}

// -----------------------------------------------------------------------------
// Carga desde BD + evaluación (única función que toca Prisma)
// -----------------------------------------------------------------------------

interface AbacRuleRow {
  id: string;
  recurso: string;
  accion: string;
  effect: string;
  prioridad: number;
  descripcion: string | null;
  condiciones: unknown;
  active: boolean;
}

/**
 * Parsea `condiciones` (Prisma Json) a `AbacCondicion[]`. Una fila con JSON
 * inválido se trata como "sin condiciones parseables" → se excluye de la
 * evaluación (fail-closed a nivel de LA REGLA, no del resultado global: una
 * regla corrupta simplemente no participa, no tumba la request).
 */
function parseCondiciones(raw: unknown): AbacCondicion[] | null {
  const arr = Array.isArray(raw) ? raw : [];
  const parsed = abacCondicionSchema.array().safeParse(arr);
  return parsed.success ? parsed.data : null;
}

function toRuleRuntime(row: AbacRuleRow): AbacRuleRuntime | null {
  const condiciones = parseCondiciones(row.condiciones);
  if (condiciones === null) return null;
  return {
    id: row.id,
    recurso: row.recurso as AbacRecurso,
    accion: row.accion as AbacAccion,
    effect: row.effect as AbacRuleRuntime["effect"],
    prioridad: row.prioridad,
    descripcion: row.descripcion,
    condiciones,
    active: row.active,
  };
}

/**
 * Carga las `AbacRule` activas del tenant para (recurso, accion) y resuelve
 * la decisión. Envuelto en `withTenantContext` — contrato RLS obligatorio
 * (ver CLAUDE.md §RLS): el filtro `organizationId` en el `where` es defensa
 * adicional, NO el único mecanismo de aislamiento tenant.
 */
export async function evaluarAbac(
  prisma: PrismaClient,
  tenant: Pick<TenantContext, "userId" | "organizationId">,
  params: {
    recurso: AbacRecurso;
    accion: AbacAccion;
    atributos: AbacAtributosRuntime;
  },
): Promise<AbacDecision> {
  const rows = await withTenantContext(prisma, tenant, (tx) =>
    tx.abacRule.findMany({
      where: {
        organizationId: tenant.organizationId,
        recurso: params.recurso,
        accion: params.accion,
        active: true,
      },
    }),
  );

  // `rows` defiende contra mocks de test (`mockDeep<PrismaClient>()` sin
  // stub explícito de `abacRule.findMany` devuelve `undefined`) — en
  // producción Prisma siempre resuelve un array (vacío si no hay filas).
  const reglas = (rows ?? [])
    .map((r) => toRuleRuntime(r as unknown as AbacRuleRow))
    .filter((r): r is AbacRuleRuntime => r !== null);

  return resolverDecision(reglas, params.atributos);
}
