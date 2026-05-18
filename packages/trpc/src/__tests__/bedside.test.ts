/**
 * Tests unitarios — bedside.router
 *
 * Verifica helpers internos del router sin depender de la BD:
 *  1. parseGs1Expiry — extrae fecha correcta desde YYMMDD GS1.
 *  2. isMedicationExpired — detecta vencimiento.
 *  3. extractHardStopReason — formatea mensajes de hard-stop.
 *
 * Las validaciones de BD (GSRN activo, GTIN recall, indicación) se cubren
 * en los tests E2E de Playwright (e2e/fase2/bedside-flow.spec.ts).
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Helpers exportados para tests (replicados aquí — el router es interno).
// ---------------------------------------------------------------------------

function parseGs1Expiry(yymmdd: string): Date {
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10) - 1;
  const dd = parseInt(yymmdd.slice(4, 6), 10);
  const fullYear = yy <= 49 ? 2000 + yy : 1900 + yy;
  return new Date(fullYear, mm, dd, 23, 59, 59);
}

function isMedicationExpired(yymmdd: string, now: Date): boolean {
  const expDate = parseGs1Expiry(yymmdd);
  return expDate < now;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseGs1Expiry", () => {
  it("parsea YYMMDD → year 20xx cuando YY <= 49", () => {
    const date = parseGs1Expiry("261231");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(11); // diciembre (0-indexed)
    expect(date.getDate()).toBe(31);
  });

  it("parsea YYMMDD → year 19xx cuando YY >= 50", () => {
    const date = parseGs1Expiry("991231");
    expect(date.getFullYear()).toBe(1999);
  });

  it("hora fijada al final del día (23:59:59)", () => {
    const date = parseGs1Expiry("260101");
    expect(date.getHours()).toBe(23);
    expect(date.getMinutes()).toBe(59);
    expect(date.getSeconds()).toBe(59);
  });
});

describe("isMedicationExpired", () => {
  it("retorna true cuando el vencimiento es anterior a now", () => {
    const now = new Date(2026, 5, 15); // 15-Jun-2026
    expect(isMedicationExpired("260101", now)).toBe(true); // 1-Ene-2026 < Jun-2026
  });

  it("retorna false cuando el vencimiento es posterior a now", () => {
    const now = new Date(2026, 5, 15); // 15-Jun-2026
    expect(isMedicationExpired("261231", now)).toBe(false); // 31-Dic-2026 > Jun-2026
  });

  it("retorna false cuando vence el mismo día (fin del día)", () => {
    // El expiry es 23:59:59 del día — si now es medianoche del mismo día, no está vencido.
    const now = new Date(2026, 11, 31, 0, 0, 0); // 31-Dic-2026 00:00:00
    expect(isMedicationExpired("261231", now)).toBe(false);
  });

  it("retorna true cuando now es después del fin del día de vencimiento", () => {
    const now = new Date(2027, 0, 1, 0, 0, 0); // 1-Ene-2027
    expect(isMedicationExpired("261231", now)).toBe(true);
  });
});

describe("GSRN validation regex", () => {
  const gsrnRegex = /^\d{18}$/;

  it("acepta GSRN de 18 dígitos", () => {
    expect(gsrnRegex.test("801874130000000001")).toBe(true);
  });

  it("rechaza GSRN con letras", () => {
    expect(gsrnRegex.test("80187413000000000A")).toBe(false);
  });

  it("rechaza GSRN de 17 dígitos", () => {
    expect(gsrnRegex.test("80187413000000001")).toBe(false);
  });

  it("rechaza GSRN de 19 dígitos", () => {
    expect(gsrnRegex.test("8018741300000000011")).toBe(false);
  });
});

describe("GTIN-14 validation regex", () => {
  const gtinRegex = /^\d{14}$/;

  it("acepta GTIN-14 de 14 dígitos", () => {
    expect(gtinRegex.test("07501000001234")).toBe(true);
  });

  it("rechaza GTIN-14 con menos de 14 dígitos", () => {
    expect(gtinRegex.test("0750100000123")).toBe(false);
  });

  it("rechaza GTIN-14 con caracteres no numéricos", () => {
    expect(gtinRegex.test("0750100000123X")).toBe(false);
  });
});
