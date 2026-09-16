/**
 * Tests de los schemas CC-0036 Ola 1B (REQ-HIS-AFIL-001 US.AFIL.1.1/1.2).
 */
import { describe, it, expect } from "vitest";
import {
  consultorioTipoUsoEnum,
  medicoAfiliadoTipoRelacionEnum,
  medicoAfiliadoEstadoEnum,
  consultorioCreateSchema,
  consultorioUpdateSchema,
  medicoAfiliadoCreateSchema,
  medicoAfiliadoDarBajaSchema,
} from "../afiliado";

const uuid = "00000000-0000-0000-0000-000000000001";

describe("enums", () => {
  it.each(["ARRENDADO", "PROPIO", "MIXTO"])("tipoUso %s válido", (v) =>
    expect(consultorioTipoUsoEnum.safeParse(v).success).toBe(true),
  );
  it("tipoUso inválido rechazado", () =>
    expect(consultorioTipoUsoEnum.safeParse("OTRO").success).toBe(false));

  it.each(["AFILIADO_ARRENDATARIO", "AFILIADO_SIN_CONSULTORIO", "STAFF_INTERNO"])(
    "tipoRelacion %s válido",
    (v) => expect(medicoAfiliadoTipoRelacionEnum.safeParse(v).success).toBe(true),
  );

  it.each(["PROSPECTO", "ACTIVO", "SUSPENDIDO", "INACTIVO"])("estado %s válido", (v) =>
    expect(medicoAfiliadoEstadoEnum.safeParse(v).success).toBe(true),
  );
  it("estado inválido rechazado", () =>
    expect(medicoAfiliadoEstadoEnum.safeParse("BORRADOR").success).toBe(false));
});

describe("consultorioCreateSchema", () => {
  it("acepta el mínimo requerido", () => {
    const result = consultorioCreateSchema.safeParse({
      establishmentId: uuid,
      codigo: "CE-201",
      nombre: "Consultorio 201",
      tipoUso: "PROPIO",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza código vacío", () => {
    const result = consultorioCreateSchema.safeParse({
      establishmentId: uuid,
      codigo: "",
      nombre: "Consultorio 201",
      tipoUso: "PROPIO",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza GLN que no sea GLN-13 numérico", () => {
    const result = consultorioCreateSchema.safeParse({
      establishmentId: uuid,
      codigo: "CE-201",
      nombre: "Consultorio 201",
      tipoUso: "PROPIO",
      glnCodigo: "abc",
    });
    expect(result.success).toBe(false);
  });
});

describe("consultorioUpdateSchema", () => {
  it("no expone `codigo` como editable", () => {
    const result = consultorioUpdateSchema.safeParse({ id: uuid, nombre: "Nuevo" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).codigo).toBeUndefined();
    }
  });
});

describe("medicoAfiliadoCreateSchema", () => {
  it("acepta el mínimo requerido — queda en PROSPECTO en el router", () => {
    const result = medicoAfiliadoCreateSchema.safeParse({
      nombreCompleto: "Dr. Juan Pérez",
      jvpmNumero: "12345",
      tipoRelacion: "AFILIADO_ARRENDATARIO",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza JVPM vacío", () => {
    const result = medicoAfiliadoCreateSchema.safeParse({
      nombreCompleto: "Dr. Juan Pérez",
      jvpmNumero: "",
      tipoRelacion: "AFILIADO_ARRENDATARIO",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza tipoRelacion fuera de vocabulario", () => {
    const result = medicoAfiliadoCreateSchema.safeParse({
      nombreCompleto: "Dr. Juan Pérez",
      jvpmNumero: "12345",
      tipoRelacion: "OTRO",
    });
    expect(result.success).toBe(false);
  });
});

describe("medicoAfiliadoDarBajaSchema", () => {
  it("exige fechaBaja y motivoBaja no vacío (US.AFIL.1.2 AC4)", () => {
    expect(
      medicoAfiliadoDarBajaSchema.safeParse({ id: uuid, fechaBaja: "2026-09-15", motivoBaja: "" })
        .success,
    ).toBe(false);
    expect(
      medicoAfiliadoDarBajaSchema.safeParse({
        id: uuid,
        fechaBaja: "2026-09-15",
        motivoBaja: "Renuncia voluntaria",
      }).success,
    ).toBe(true);
  });
});
