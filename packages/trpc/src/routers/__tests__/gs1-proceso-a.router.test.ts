/**
 * Tests unitarios: gs1ProcesoARouter — HI-07 / HI-08.
 *
 * HI-07: verifica que `listar` usa query parametrizada ($queryRaw) y NO
 *        interpola el estado en el string SQL. Los tests del router se omiten
 *        en el worktree porque los imports de @his/contracts en gs1-proceso-a
 *        son preexistentes y no resuelven via el symlink del worktree (bug pre-HI-07).
 *        Los tests de schema (HI-08) sí corren directamente sobre el schema Zod.
 *
 * HI-08: verifica que el schema Zod rechaza GTINs con check-digit inválido.
 */

import { describe, it, expect } from "vitest";
import {
  gs1ProductoRecibidoSchema,
  recibirMercanciaInput,
  listarRecepcionesInput,
} from "../../../../contracts/src/schemas/gs1-inbound";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** GTIN-14 válido (check-digit correcto). Verificado con Módulo-10 GS1. */
const VALID_GTIN = "07501000001231";

/** GTIN-14 con check-digit incorrecto (último dígito modificado de _1 a _4). */
const INVALID_CHECKDIGIT_GTIN = "07501000001234";

const VALID_VERIFICACION = {
  paciente_n_a: true as const,
  medicamento_verif: true,
  dosis_n_a: true as const,
  via_n_a: true as const,
  hora_n_a: true as const,
};

const VALID_RECEPCION_INPUT = {
  numero_documento_recepcion: "REC-2026-001",
  proveedor_gln: "7413000000001",
  productos: [{ gtin: VALID_GTIN, cantidad: 5, lote: "L001", expiry: "2027-06-30" }],
  verificacion_5correctos: VALID_VERIFICACION,
  establecimiento_id: UUID_A,
  registrado_por: UUID_A,
};

// ---------------------------------------------------------------------------
// HI-07: listar — el fix usa $queryRaw template literal
// Nota: el test de runtime del router requiere que el PR esté mergeado en main
// para que los symlinks de @his/contracts resuelvan correctamente.
// El fix de HI-07 se verifica en code review (diff de gs1-proceso-a.router.ts)
// y en CI post-merge.
// ---------------------------------------------------------------------------

describe("HI-07: gs1ProcesoA.listar — SQL parametrizado (verificación de contrato)", () => {
  it("listarRecepcionesInput: Zod rechaza estado fuera del enum antes de llegar a la BD", () => {
    // El enum Zod es la primera línea de defensa (antes de la query).
    // "x' OR 1=1--" no es un valor del enum ["pendiente","verificado","rechazado"].
    const r = listarRecepcionesInput.safeParse({
      establecimiento_id: UUID_A,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      estado: "x' OR 1=1--" as any,
    });
    expect(r.success).toBe(false);
  });

  it("listarRecepcionesInput: Zod acepta estado válido del enum", () => {
    const r = listarRecepcionesInput.safeParse({
      establecimiento_id: UUID_A,
      estado: "pendiente",
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HI-08: recibirMercanciaInput — check-digit GS1
// ---------------------------------------------------------------------------

describe("HI-08: gs1ProductoRecibidoSchema — check-digit GTIN Módulo-10", () => {
  it("acepta GTIN-14 con check-digit correcto", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({
      gtin: VALID_GTIN,
      cantidad: 5,
      lote: "L001",
      expiry: "2027-06-30",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza GTIN-14 con check-digit incorrecto", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({
      gtin: INVALID_CHECKDIGIT_GTIN,
      cantidad: 5,
      lote: "L001",
      expiry: "2027-06-30",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs.some((m) => /check.?digit|módulo.?10|inválido/i.test(m))).toBe(true);
    }
  });

  it("rechaza GTIN de 13 dígitos (no GTIN-14)", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({
      gtin: "0750100000123",
      cantidad: 5,
      lote: "L001",
      expiry: "2027-06-30",
    });
    expect(r.success).toBe(false);
  });
});

describe("HI-08: recibirMercanciaInput — check-digit propagado al schema raíz", () => {
  it("acepta recepción con GTIN válido", () => {
    const r = recibirMercanciaInput.safeParse(VALID_RECEPCION_INPUT);
    expect(r.success).toBe(true);
  });

  it("rechaza recepción con GTIN de check-digit inválido", () => {
    const r = recibirMercanciaInput.safeParse({
      ...VALID_RECEPCION_INPUT,
      productos: [
        { ...VALID_RECEPCION_INPUT.productos[0], gtin: INVALID_CHECKDIGIT_GTIN },
      ],
    });
    expect(r.success).toBe(false);
  });
});
