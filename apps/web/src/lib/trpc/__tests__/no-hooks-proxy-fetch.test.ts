/**
 * Guarda de regresión — hallazgo E2E RN-HIS-BOT-001 (2026-09-12).
 *
 * El proxy de hooks de tRPC (`trpc.*` de createTRPCReact) NO expone `.fetch()`
 * imperativo: eso vive en `trpc.useUtils()`. Llamar `trpc.<router>.<proc>
 * .fetch(...)` (o vía un alias `trpcAny = trpc as any`, que apaga el chequeo
 * de tipos) compila, pero lanza TypeError en runtime — así estuvo caído TODO
 * el flujo de dispensación GS1 (dispense/page.tsx y dispense/[orderId]/
 * page.tsx) sin que ningún test lo detectara.
 *
 * Este test escanea el código fuente cliente y falla si el patrón reaparece.
 * El fix correcto siempre es: `const utils = trpc.useUtils()` y
 * `utils.<router>.<proc>.fetch(...)`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");

// `trpcAny.x.y.fetch(` o `trpc.x.y.fetch(` — pero nunca `useUtils()...fetch(`
// ni el fetch global de red `fetch(` a secas.
const OFENSOR = /\btrpc(?:Any)?\.(?!useUtils\b)[\w$]+(?:\.[\w$]+)*\.fetch\(/;

function* archivosTsx(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* archivosTsx(full);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) yield full;
  }
}

describe("proxy de hooks tRPC — sin .fetch() imperativo", () => {
  it("ningún archivo cliente llama .fetch() sobre trpc/trpcAny (usar useUtils())", () => {
    const ofensores: string[] = [];
    for (const file of archivosTsx(SRC_ROOT)) {
      const src = readFileSync(file, "utf8");
      if (OFENSOR.test(src)) {
        const linea = src.split("\n").findIndex((l) => OFENSOR.test(l)) + 1;
        ofensores.push(`${file}:${linea}`);
      }
    }
    expect(
      ofensores,
      `Llamadas .fetch() sobre el proxy de hooks (TypeError en runtime — usar trpc.useUtils()):\n${ofensores.join("\n")}`,
    ).toEqual([]);
  });
});
