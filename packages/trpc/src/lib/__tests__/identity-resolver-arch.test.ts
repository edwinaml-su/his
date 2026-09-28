/**
 * identity-resolver-arch.test.ts — R03, gate "0 his_user_id fuera del resolver".
 *
 * Guarda de arquitectura (assessment externo, riesgo Alto — "Identidad
 * HIS↔ECE no unificada"): al momento de introducir esta guarda había 89
 * apariciones de `his_user_id` en 42 archivos de `packages/trpc/src` y
 * `apps/web/src` (sin contar el resolver ni los tests), cada una
 * reimplementando (o solo documentando) el mismo lookup que
 * `packages/trpc/src/lib/identity-resolver.ts` centraliza.
 *
 * Esta guarda falla si aparece el string `his_user_id` en esos árboles fuera
 * de `identity-resolver.ts`, de un archivo de test, o de una entrada
 * explícita en `ALLOWLIST` con su motivo. La migración es incremental (ver
 * la receta al final de `identity-resolver.ts`): cada PR que migra un
 * archivo lo saca de `ALLOWLIST`, y el gate está cerrado cuando la allowlist
 * queda vacía (o solo con las entradas "no es un lookup de identidad", que
 * nunca deberían pasar por el resolver).
 *
 * Un segundo test evita que la allowlist acumule deuda fantasma: si un
 * archivo listado ya no contiene `his_user_id` (se migró y nadie lo sacó de
 * la lista) o directamente no existe, falla — así el gate mide progreso
 * real, no solo la ausencia de errores.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// packages/trpc/src/lib/__tests__ → packages/trpc/src (2 niveles arriba).
const TRPC_SRC = join(__dirname, "..", "..");
// packages/trpc/src/lib/__tests__ → raíz del repo (5 niveles arriba) → apps/web/src.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const WEB_SRC = join(REPO_ROOT, "apps", "web", "src");

const RESOLVER_PATH = join(TRPC_SRC, "lib", "identity-resolver.ts");

/**
 * archivo (relativo a la raíz del repo) → motivo concreto por el que TODAVÍA
 * tiene `his_user_id` fuera del resolver. Dos categorías:
 *
 *   - "Pendiente — R03 stage 2": archivo aún no migrado, en cola. Migrarlo
 *     saca la entrada de esta lista (no requiere motivo más específico).
 *   - Motivo puntual: el uso NO es un lookup de identidad hacia
 *     `ece.personal_salud` (filtro de reporte, columna de un JOIN de
 *     negocio, etc.) — no debería pasar por el resolver nunca, o requiere
 *     coordinación fuera del alcance de una migración mecánica de lectura.
 */
const ALLOWLIST: Record<string, string> = {
  // ── Migrado (identity resolution), pero con un uso adicional que NO es
  //    un lookup de identidad — ver receta punto 2 en identity-resolver.ts.
  "packages/trpc/src/routers/ece/critical-result.router.ts":
    "Ya usa resolvePersonalSalud para la identidad del usuario en sesión " +
    "(línea ~242). El his_user_id restante es un FILTRO DE REPORTE " +
    "(medicoFilter, opcional) sobre notificaciones de resultado crítico, " +
    "fusionado con orden por severidad/fecha — no es un lookup de " +
    "identidad a resolver. Documentado también en la receta de migración " +
    "de identity-resolver.ts (\"otro equipo lo está tocando\").",

  // ── R03 stage 2 (este cambio): los 21 archivos que quedaban en "Pendiente"
  //    ya están migrados (comentarios reescritos sin el literal, o lookups
  //    fusionados separados en requirePersonalSalud/resolvePersonalSalud +
  //    query de negocio acotada por personal.id — certificado-defuncion.ts,
  //    retencion.ts, partograma.ts, firma-electronica.ts#history). Ver
  //    identity-resolver.ts para el contrato y la receta de migración.
  //
  //    firma-electronica.router.ts es el único que sigue en la allowlist:
  //    dos de sus procedures (requestRecovery, completeRecovery) son
  //    publicProcedure PRE-SESIÓN — no hay ctx.user.id del que partir — y
  //    resuelven en dirección INVERSA a la del módulo (email/firmaId →
  //    personal_salud → hisUserId, no hisUserId → personal_salud). No son
  //    drop-in: identity-resolver.ts solo resuelve la dirección hacia
  //    adelante. Comentados in situ en el router.
  "packages/trpc/src/routers/firma-electronica.router.ts":
    "requestRecovery/completeRecovery: publicProcedure pre-sesión, dirección " +
    "inversa (email o firmaId → personal_salud → hisUserId) — no la que " +
    "resuelve identity-resolver.ts (hisUserId → personal_salud). El resto " +
    "del archivo (setup/verify/confirm/status/history) ya delega al resolver.",

  // ── Lado de ESCRITURA (alta/vínculo de personal_salud), no de lectura.
  //    identity-resolver.ts documenta explícitamente (punto 4 de la receta)
  //    que este archivo NO se migra como parte de una migración mecánica de
  //    lectura: es dónde `his_user_id` se ESCRIBE, y hoy tiene su propio
  //    defecto (create/linkAuthUser no siempre lo setean) — cerrarlo es un
  //    cambio de producto, no un refactor de lookup.
  "packages/trpc/src/routers/personal-salud.router.ts":
    "Lado de escritura (alta/vínculo de his_user_id), no de lectura — ver " +
    "punto 4 de la receta de migración en identity-resolver.ts. Cerrar su " +
    "propio defecto (create/linkAuthUser) es un cambio de producto, fuera " +
    "de alcance de R03 stage 1/2.",
  "apps/web/src/app/(admin)/_components/personal-salud-screen.tsx":
    "UI del alta/vínculo de personal_salud (mismo alcance que " +
    "personal-salud.router.ts arriba) — comentarios que documentan el " +
    "campo `his_user_id`, no una query. Pendiente junto con el router.",
};

function* archivosFuente(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* archivosFuente(full);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && full !== RESOLVER_PATH) {
      yield full;
    }
  }
}

describe("his_user_id — gate de migración al resolver canónico (R03)", () => {
  it("todo archivo con his_user_id fuera del resolver está en la allowlist con motivo", () => {
    const ofensores: string[] = [];
    for (const root of [TRPC_SRC, WEB_SRC]) {
      for (const file of archivosFuente(root)) {
        const src = readFileSync(file, "utf8");
        if (!src.includes("his_user_id")) continue;
        const rel = relative(REPO_ROOT, file).split("\\").join("/");
        if (!(rel in ALLOWLIST)) {
          ofensores.push(rel);
        }
      }
    }
    expect(
      ofensores,
      `Archivos con his_user_id fuera del resolver, sin entrada en la ALLOWLIST ` +
        `de identity-resolver-arch.test.ts:\n${ofensores.join("\n")}`,
    ).toEqual([]);
  });

  it("la allowlist no acumula entradas obsoletas", () => {
    const obsoletas: string[] = [];
    for (const rel of Object.keys(ALLOWLIST)) {
      const full = join(REPO_ROOT, rel);
      let src: string;
      try {
        src = readFileSync(full, "utf8");
      } catch {
        obsoletas.push(`${rel} — el archivo ya no existe, sacalo de la allowlist`);
        continue;
      }
      if (!src.includes("his_user_id")) {
        obsoletas.push(`${rel} — ya no contiene his_user_id, sacalo de la allowlist`);
      }
    }
    expect(
      obsoletas,
      `Entradas obsoletas en la ALLOWLIST de identity-resolver-arch.test.ts:\n${obsoletas.join("\n")}`,
    ).toEqual([]);
  });
});
