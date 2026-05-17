/**
 * Smoke test — verifica que los modelos ECE añadidos en el sync de drift
 * son accesibles en el cliente Prisma generado (compilación TS).
 *
 * NO requiere conexión a BD. Solo valida tipado en tiempo de compilación
 * y que los delegados existen en el namespace del cliente.
 */
import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";

// Instanciamos el cliente SIN conectar (solo verificamos que los delegados existen)
const prisma = new PrismaClient();

describe("ECE drift sync — modelos Prisma compilados", () => {
  it("delegados SQL 59/61/66 existen en PrismaClient", () => {
    expect(typeof prisma.eceEpisodioEstadoLog.count).toBe("function");
    expect(typeof prisma.eceValoracionInicialEnfermeria.count).toBe("function");
    // EceTriaje ahora mapeado a hoja_triaje — delegado debe existir
    expect(typeof prisma.eceTriaje.count).toBe("function");
    // EceReferenciaRri ahora mapeado a rri
    expect(typeof prisma.eceReferenciaRri.count).toBe("function");
  });

  it("delegados SQL 67–71 (quirurgico/obstetrico) existen", () => {
    expect(typeof prisma.ecePreopChecklist.count).toBe("function");
    expect(typeof prisma.eceWhoChecklist.count).toBe("function");
    expect(typeof prisma.eceRegistroAnestesico.count).toBe("function");
    expect(typeof prisma.eceUrpaRecovery.count).toBe("function");
    expect(typeof prisma.ecePartogramaRegistro.count).toBe("function");
  });

  it("delegados SQL 73–74 (neonatal) existen", () => {
    expect(typeof prisma.eceAtencionRecienNacido.count).toBe("function");
    expect(typeof prisma.eceReanimacionNeonatal.count).toBe("function");
  });

  it("delegados SQL 76 (GS1 catalogos) existen", () => {
    expect(typeof prisma.eceGs1Gtin.count).toBe("function");
    expect(typeof prisma.eceGs1Gln.count).toBe("function");
    expect(typeof prisma.eceGs1Sscc.count).toBe("function");
    expect(typeof prisma.eceGs1Gsrn.count).toBe("function");
    expect(typeof prisma.eceGs1Giai.count).toBe("function");
  });

  it("delegados SQL 77–80 (supply chain) existen", () => {
    expect(typeof prisma.eceRecepcionMercancia.count).toBe("function");
    expect(typeof prisma.eceTransferenciaInventario.count).toBe("function");
    expect(typeof prisma.ecePreparacionUnidosis.count).toBe("function");
    expect(typeof prisma.eceDevolucionInventario.count).toBe("function");
  });

  it("delegados SQL 83–84 (inventario y cadena frio) existen", () => {
    expect(typeof prisma.eceInventoryThreshold.count).toBe("function");
    expect(typeof prisma.eceColdChainLectura.count).toBe("function");
    expect(typeof prisma.eceColdChainAlerta.count).toBe("function");
    expect(typeof prisma.eceColdChainConfigEquipo.count).toBe("function");
  });
});
