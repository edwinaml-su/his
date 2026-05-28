/**
 * Tests del predicado de visibilidad del sidebar (Nivel A).
 *
 * Cubre las 8 combinaciones que el filtro debe distinguir:
 *   - sin requisitos → visible siempre
 *   - solo requiredRoles → respeta intersección
 *   - solo requiredServiceUnits con/ sin asignaciones / cross-service / no
 *   - combinación de ambos
 */
import { describe, it, expect } from "vitest";
import { isItemVisible, type NavItemVisibility } from "../nav-visibility";

describe("isItemVisible — sin requisitos", () => {
  const item: NavItemVisibility = {};

  it("muestra el item para cualquier usuario", () => {
    expect(isItemVisible(item, [], [], false)).toBe(true);
    expect(isItemVisible(item, ["NURSE"], ["ER"], false)).toBe(true);
    expect(isItemVisible(item, ["ADMIN"], [], true)).toBe(true);
  });
});

describe("isItemVisible — requiredRoles", () => {
  const item: NavItemVisibility = { requiredRoles: ["ADMIN", "DIR"] };

  it("muestra si el usuario tiene al menos un rol requerido", () => {
    expect(isItemVisible(item, ["ADMIN"], [], false)).toBe(true);
    expect(isItemVisible(item, ["DIR"], [], false)).toBe(true);
    expect(isItemVisible(item, ["NURSE", "DIR"], [], false)).toBe(true);
  });

  it("oculta si el usuario no tiene ninguno de los roles requeridos", () => {
    expect(isItemVisible(item, [], [], false)).toBe(false);
    expect(isItemVisible(item, ["NURSE"], [], false)).toBe(false);
  });
});

describe("isItemVisible — requiredServiceUnits (Nivel A)", () => {
  const erItem: NavItemVisibility = { requiredServiceUnits: ["ER"] };
  const qxItem: NavItemVisibility = { requiredServiceUnits: ["QX"] };
  const multiItem: NavItemVisibility = { requiredServiceUnits: ["PARTOS", "UCIN"] };

  it("muestra cuando hay intersección con la asignación del usuario", () => {
    expect(isItemVisible(erItem, ["NURSE"], ["ER"], false)).toBe(true);
    expect(isItemVisible(multiItem, ["NURSE"], ["UCIN"], false)).toBe(true);
    expect(isItemVisible(multiItem, ["NURSE"], ["PARTOS", "ER"], false)).toBe(true);
  });

  it("oculta cuando no hay intersección y usuario tiene asignaciones", () => {
    expect(isItemVisible(erItem, ["NURSE"], ["QX"], false)).toBe(false);
    expect(isItemVisible(qxItem, ["NURSE"], ["ER", "CE"], false)).toBe(false);
  });

  it("bypassea el filtro si el usuario es cross-service (ADMIN/DIR/…)", () => {
    expect(isItemVisible(erItem, ["ADMIN"], [], true)).toBe(true);
    expect(isItemVisible(qxItem, ["DIR"], [], true)).toBe(true);
    expect(isItemVisible(multiItem, ["COO"], [], true)).toBe(true);
  });

  it("muestra el item si el usuario no tiene asignaciones (backward compat)", () => {
    // Caso: usuario pre-Nivel-A o sin asignación aún configurada — no rompemos.
    expect(isItemVisible(erItem, ["NURSE"], [], false)).toBe(true);
    expect(isItemVisible(qxItem, ["MC"], [], false)).toBe(true);
  });
});

describe("isItemVisible — requiredRoles + requiredServiceUnits combinados", () => {
  const item: NavItemVisibility = {
    requiredRoles: ["DIR", "MEDICAL_DIRECTOR"],
    requiredServiceUnits: ["QX"],
  };

  it("oculta si el rol no calza (aunque tenga el servicio)", () => {
    expect(isItemVisible(item, ["NURSE"], ["QX"], false)).toBe(false);
  });

  it("muestra si rol calza Y es cross-service (bypass servicio)", () => {
    expect(isItemVisible(item, ["DIR"], [], true)).toBe(true);
  });

  it("muestra si rol calza Y servicio intersecta", () => {
    expect(isItemVisible(item, ["MEDICAL_DIRECTOR"], ["QX"], false)).toBe(true);
  });

  it("oculta si rol calza pero servicio no intersecta y no es cross-service", () => {
    expect(isItemVisible(item, ["MEDICAL_DIRECTOR"], ["ER"], false)).toBe(false);
  });
});
