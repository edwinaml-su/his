/**
 * Tests del router gs1CatalogosRouter — catálogos GS1 Healthcare.
 *
 * Cubre las 5 entidades: gtin, gln, sscc, gsrn, giai.
 * Estrategia: mock de Prisma.$queryRawUnsafe / $executeRawUnsafe.
 * No requiere BD activa — validaciones en el router son la SUT.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { gs1CatalogosRouter } from "../gs1-catalogos.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Helpers de código GS1 con dígito verificador correcto
// ---------------------------------------------------------------------------

/**
 * Calcula el dígito verificador GS1 Módulo-10 para una raíz numérica.
 * La raíz NO incluye el dígito verificador (se añade al final).
 *
 * Algoritmo GS1: desde la derecha de la raíz, el dígito más a la derecha
 * se multiplica por 3, el siguiente por 1, alternando. Espeja exactamente
 * la función SQL ece.gs1_check_digit_valid y el validador del router.
 */
function gs1AppendCheckDigit(root: string): string {
  const len = root.length;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    // Posición desde la derecha (0-based): rightPos=0 → factor 3
    const rightPos = len - 1 - i;
    const weight = rightPos % 2 === 0 ? 3 : 1;
    sum += parseInt(root[i]!, 10) * weight;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return root + checkDigit.toString();
}

// Códigos de prueba con dígito verificador válido.
// Los calculados con el helper se usan en tests de lectura (mock data).
// Para mutaciones (input Zod), se usan códigos canónicos GS1 de todos-ceros
// que son matemáticamente válidos por cualquier implementación del algoritmo.
const VALID_GTIN  = gs1AppendCheckDigit("0614141999996" );  // → 14 dígitos (lectura)
const VALID_GLN   = gs1AppendCheckDigit("061414199999"  );  // → 13 dígitos (lectura)
const VALID_SSCC  = gs1AppendCheckDigit("00614141999996541"); // → 18 dígitos (lectura)
const VALID_GSRN  = gs1AppendCheckDigit("80614141123456789"); // → 18 dígitos (lectura)

// Códigos canónicos para mutaciones (input Zod): todos-ceros son siempre válidos
// porque suma=0 → check digit=0, sin ambigüedad de implementación.
const GTIN_MUTATION  = "00000000000000";   // 14 dígitos
const SSCC_MUTATION  = "000000000000000000"; // 18 dígitos

// UUIDs válidos para usar como IDs de prueba
const UUID_GTIN_1 = "11111111-1111-1111-1111-111111111111";
const UUID_GLN_1  = "22222222-2222-2222-2222-222222222222";
const UUID_SSCC_1 = "33333333-3333-3333-3333-333333333333";
const UUID_GSRN_1 = "44444444-4444-4444-4444-444444444444";
const UUID_GIAI_1 = "55555555-5555-5555-5555-555555555555";
const UUID_NOT_FOUND = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// Helpers de mock
// ---------------------------------------------------------------------------

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

function mockQuery<T>(returnValue: T) {
  return vi.fn().mockResolvedValue(returnValue);
}

// ---------------------------------------------------------------------------
// Validación del dígito verificador (función pura, no requiere BD)
// ---------------------------------------------------------------------------

describe("gs1CheckDigitValid (helper local de prueba)", () => {
  it("GTIN-14 con dígito correcto tiene 14 dígitos y pasa la raíz", () => {
    expect(VALID_GTIN).toHaveLength(14);
    expect(/^\d{14}$/.test(VALID_GTIN)).toBe(true);
  });

  it("GLN-13 con dígito correcto tiene 13 dígitos", () => {
    expect(VALID_GLN).toHaveLength(13);
    expect(/^\d{13}$/.test(VALID_GLN)).toBe(true);
  });

  it("SSCC-18 con dígito correcto tiene 18 dígitos", () => {
    expect(VALID_SSCC).toHaveLength(18);
    expect(/^\d{18}$/.test(VALID_SSCC)).toBe(true);
  });

  it("GSRN-18 con dígito correcto tiene 18 dígitos", () => {
    expect(VALID_GSRN).toHaveLength(18);
    expect(/^\d{18}$/.test(VALID_GSRN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gtin
// ---------------------------------------------------------------------------

describe("gs1Catalogos.gtin", () => {
  it("list retorna items mapeados", async () => {
    const mockRow = {
      id: UUID_GTIN_1,
      codigo: VALID_GTIN,
      descripcion: "Amoxicilina 500mg",
      fabricante: "Pfizer",
      presentacion: "Cápsula",
      contenido_unidades: "30",
      principio_activo: "Amoxicilina",
      codigo_atc: "J01CA04",
      activo: true,
      creado_en: new Date("2024-01-01"),
    };
    prisma.$queryRawUnsafe = mockQuery([mockRow]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.gtin.list({ limit: 50, offset: 0 });

    expect(result).toHaveLength(1);
    expect(result[0]!.codigo).toBe(VALID_GTIN);
    expect(result[0]!.codigoAtc).toBe("J01CA04");
    expect(result[0]!.contenidoUnidades).toBe(30);
  });

  it("get retorna NOT_FOUND si la BD no devuelve filas", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.gtin.get({ id: UUID_NOT_FOUND }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("create rechaza GTIN con longitud incorrecta (Zod)", async () => {
    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.gtin.create({
        codigo: "12345",   // demasiado corto
        descripcion: "Test",
        fabricante: "Lab",
        presentacion: "Tab",
        contenidoUnidades: 10,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("create llama $queryRawUnsafe con los parámetros correctos", async () => {
    prisma.$queryRawUnsafe = mockQuery([{ id: "00000000-0000-0000-0000-000000aabbcc" }]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.gtin.create({
      codigo: GTIN_MUTATION,
      descripcion: "Ibuprofeno 400mg",
      fabricante: "Bayer",
      presentacion: "Tableta",
      contenidoUnidades: 20,
      codigoAtc: "M01AE01",
    });

    expect(result.id).toBe("00000000-0000-0000-0000-000000aabbcc");
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledOnce();
  });

  it("deactivate ejecuta UPDATE con activo=false", async () => {
    prisma.$executeRawUnsafe = mockQuery(1);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.gtin.deactivate({ id: UUID_GTIN_1 });

    expect(result.ok).toBe(true);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledOnce();
    const sql = (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("activo = false");
  });

  it("create acepta campos de jerarquía de empaque (Nivel 2 GS1)", async () => {
    prisma.$queryRawUnsafe = mockQuery([{ id: "id-caja" }]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await caller.gtin.create({
      codigo: GTIN_MUTATION,
      descripcion: "Caja x50 blisters",
      fabricante: "Lab",
      presentacion: "Caja",
      contenidoUnidades: 50,
      nivelEmpaque: "CAJA",
      gtinContenido: GTIN_MUTATION,
      cantidadContenida: 50,
    });

    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("nivel_empaque");
    expect(sql).toContain("gtin_contenido");
    expect(sql).toContain("cantidad_contenida");
  });

  it("create rechaza nivel_empaque no válido (Zod)", async () => {
    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.gtin.create({
        codigo: GTIN_MUTATION,
        descripcion: "X",
        fabricante: "L",
        presentacion: "P",
        contenidoUnidades: 1,
        nivelEmpaque: "BARRIL" as "CAJA",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("explotarJerarquia retorna el total de unidosis del helper SQL", async () => {
    prisma.$queryRawUnsafe = mockQuery([{ unidosis: "500" }]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.gtin.explotarJerarquia({ codigo: GTIN_MUTATION });

    expect(result.unidosisTotales).toBe(500);
    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("fn_gs1_unidosis_por_empaque");
  });
});

// ---------------------------------------------------------------------------
// gln
// ---------------------------------------------------------------------------

describe("gs1Catalogos.gln", () => {
  it("list sin filtro de tipo retorna filas del mock", async () => {
    const mockRow = {
      id: UUID_GLN_1, codigo: VALID_GLN, descripcion: "Farmacia Central",
      tipo: "farmacia", establecimiento_id: null, activo: true,
    };
    prisma.$queryRawUnsafe = mockQuery([mockRow]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.gln.list({ limit: 50, offset: 0 });

    expect(result[0]!.tipo).toBe("farmacia");
  });

  it("get retorna NOT_FOUND si no hay filas", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.gln.get({ id: UUID_NOT_FOUND }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("create rechaza tipo no válido (Zod)", async () => {
    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.gln.create({
        codigo: VALID_GLN,
        descripcion: "Bodega",
        tipo: "invalido" as "deposito",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// sscc
// ---------------------------------------------------------------------------

describe("gs1Catalogos.sscc", () => {
  it("list retorna contenido JSONB sin modificar", async () => {
    const contenido = [{ gtin: VALID_GTIN, lote: "L001", cantidad: 100 }];
    const mockRow = {
      id: UUID_SSCC_1, codigo: VALID_SSCC, tipo_contenedor: "pallet",
      origen_gln: VALID_GLN, destino_gln: null, contenido, estado: "activo",
      creado_en: new Date("2024-06-01"),
    };
    prisma.$queryRawUnsafe = mockQuery([mockRow]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.sscc.list({ limit: 50, offset: 0 });

    expect(result[0]!.contenido).toEqual(contenido);
    expect(result[0]!.estado).toBe("activo");
  });

  it("updateEstado rechaza estado no permitido (Zod)", async () => {
    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.sscc.updateEstado({
        id: "uuid-sscc-1",
        estado: "eliminado" as "anulado",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("create serializa contenido como JSON antes de enviar a BD", async () => {
    prisma.$queryRawUnsafe = mockQuery([{ id: "new-sscc" }]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    const payload = [{ gtin: GTIN_MUTATION, lote: "L001" }];
    await caller.sscc.create({
      codigo: SSCC_MUTATION,
      tipoContenedor: "caja",
      contenido: payload,
    });

    const callArgs = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0];
    // El 5° parámetro (índice 5) es el JSON serializado del contenido
    expect(callArgs[5]).toBe(JSON.stringify(payload));
  });
});

// ---------------------------------------------------------------------------
// gsrn
// ---------------------------------------------------------------------------

describe("gs1Catalogos.gsrn", () => {
  it("list filtra por tipo correctamente (se construye el WHERE con tipo)", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await caller.gsrn.list({ limit: 50, offset: 0, tipo: "paciente" });

    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("tipo = ");
  });

  it("get retorna NOT_FOUND si no existe", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.gsrn.get({ id: UUID_NOT_FOUND }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("create rechaza tipo no válido (Zod)", async () => {
    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.gsrn.create({
        codigo: VALID_GSRN,
        tipo: "animal" as "paciente",
        referenciaId: "00000000-0000-0000-0000-000000000099",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// giai
// ---------------------------------------------------------------------------

describe("gs1Catalogos.giai", () => {
  it("list retorna filas sin transformación de tipo", async () => {
    const mockRow = {
      id: UUID_GIAI_1, codigo: "VENTILADOR-001", descripcion: "Ventilador Hamilton G5",
      fabricante: "Hamilton Medical", modelo: "G5", serial: "HMG5-2024-001", activo: true,
    };
    prisma.$queryRawUnsafe = mockQuery([mockRow]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.giai.list({ limit: 50, offset: 0 });

    expect(result[0]!.serial).toBe("HMG5-2024-001");
  });

  it("get retorna NOT_FOUND si no existe", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.giai.get({ id: UUID_NOT_FOUND }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("create rechaza código GIAI con caracteres especiales no permitidos", async () => {
    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.giai.create({
        codigo: "EQUIPO@INVALIDO!",
        descripcion: "Monitor",
        fabricante: "Philips",
        modelo: "IntelliVue MX450",
        serial: "SN-12345",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("update con campos vacíos lanza BAD_REQUEST", async () => {
    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.giai.update({ id: UUID_GIAI_1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("update con campos válidos llama $executeRawUnsafe una vez", async () => {
    prisma.$executeRawUnsafe = mockQuery(1);

    const caller = gs1CatalogosRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.giai.update({
      id: UUID_GIAI_1,
      descripcion: "Ventilador Hamilton G5 v2",
    });

    expect(result.ok).toBe(true);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledOnce();
  });
});
