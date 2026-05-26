/**
 * Setup global para tests de routers tRPC.
 * - Silencia logs de Prisma esperados.
 * - Define matchers personalizados si hace falta.
 *
 * NOTA: usamos `vi.clearAllMocks()` en lugar de `vi.restoreAllMocks()` porque
 * el segundo resetea el `mockImplementation` de los `vi.fn()` declarados en
 * factories de `vi.mock(...)` — eso rompía los stubs de `@his/database`
 * (pharmacy/inpatient/lis) entre tests del mismo archivo.
 *
 * `clearAllMocks` solo borra `mock.calls`/`mock.results` (historial),
 * preservando la `mockImplementation`. Es suficiente para aislar tests
 * sin tirar el wiring de los stubs.
 */
import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.clearAllMocks();
});
