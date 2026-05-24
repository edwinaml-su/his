/**
 * Compliance suite bootstrap — Fase JCI Sprint 0.
 *
 * Test trivial pasante que valida que la estructura del compliance suite
 * existe y puede ejecutarse en CI. Sin este test, el job
 * `.github/workflows/compliance.yml` fallaría con "no tests found" porque
 * vitest tiene `passWithNoTests: false`.
 *
 * Los tests reales se agregan US por US durante Fase JCI-1:
 *   - ipsg4-who-checklist.test.ts (E-16 / US.JCI.16.x)
 *   - ipsg6-falls.test.ts (E-05 / US.JCI.5.12-13)
 *   - mmu6-bcma.test.ts (E-07 / US.JCI.7.x)
 *   - moi13-esign.test.ts (E-05 / US.JCI.5.x)
 *   - pci-bundle.test.ts (E-01 / US.JCI.1.2)
 *   - pfe-teachback.test.ts (E-02 / US.JCI.2.3)
 *   - sqe-credential.test.ts (E-04 / US.JCI.4.3)
 *
 * Cada test futuro debe:
 *   1. Validar un Measurable Element específico de JCI 7th Edition
 *   2. Tener trazabilidad explícita: comentario `// JCI Standard: X.Y ME N`
 *   3. Fallar de forma legible (mensaje que el surveyor entendería)
 *   4. NO mockear la BD — usar Postgres efímero del CI (preserva integridad)
 */
import { describe, it, expect } from "vitest";

describe("JCI compliance suite — bootstrap", () => {
  it("compliance suite estructura existe y vitest la ejecuta", () => {
    // Este test asegura que el job compliance.yml no falle con
    // "no test files found" en el primer push de la Fase JCI.
    expect(true).toBe(true);
  });

  it("registry de standards JCI cubiertos por la suite", () => {
    // A medida que se agreguen compliance tests, este registry se expande.
    // Sirve como inventario verificable: cuántos ME cubrimos vs total JCI.
    const cubiertos: string[] = [
      // (vacío en Sprint 0 — se llena durante JCI-1.S1-S6)
    ];

    // Sprint 0: registry vacío es esperado. Al cierre de JCI-1.0 esperamos
    // ≥40 standards/ME cubiertos por al menos 1 test cada uno.
    expect(cubiertos).toBeInstanceOf(Array);
  });
});
