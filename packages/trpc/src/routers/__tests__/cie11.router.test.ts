/**
 * Tests — router cie11 (proxy WHO ICD-11, CC-0001 RF-03).
 *
 * El cliente @his/infrastructure se mockea (preservando exports reales) para
 * controlar isWhoIcdConfigured/buscarCie11. Cubre: estado, búsqueda OK,
 * degradación a manual (no configurado / WhoIcdNotConfiguredError) y
 * BAD_GATEWAY ante error inesperado de la API.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buscarCie11,
  isWhoIcdConfigured,
  WhoIcdNotConfiguredError,
} from "@his/infrastructure";
import { cie11Router } from "../cie11.router";
import { makeCtx } from "../../__tests__/helpers/caller";

vi.mock("@his/infrastructure", async (importActual) => {
  const actual = await importActual<typeof import("@his/infrastructure")>();
  return {
    ...actual,
    isWhoIcdConfigured: vi.fn(),
    buscarCie11: vi.fn(),
  };
});

const mockedConfigured = vi.mocked(isWhoIcdConfigured);
const mockedBuscar = vi.mocked(buscarCie11);

describe("cie11Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("estado", () => {
    it("configured=true cuando la API está configurada", async () => {
      mockedConfigured.mockReturnValue(true);
      const caller = cie11Router.createCaller(makeCtx({}));
      expect(await caller.estado()).toEqual({ configured: true });
    });

    it("configured=false cuando no está configurada", async () => {
      mockedConfigured.mockReturnValue(false);
      const caller = cie11Router.createCaller(makeCtx({}));
      expect(await caller.estado()).toEqual({ configured: false });
    });
  });

  describe("buscar", () => {
    it("retorna items cuando la API está configurada", async () => {
      mockedConfigured.mockReturnValue(true);
      mockedBuscar.mockResolvedValue({
        items: [{ codigo: "5A11", titulo: "Diabetes mellitus tipo 2", uri: "uri/1" }],
      });

      const caller = cie11Router.createCaller(makeCtx({}));
      const r = await caller.buscar({ q: "diabetes", limit: 10 });

      expect(r.configured).toBe(true);
      expect(r.items).toHaveLength(1);
      expect(mockedBuscar).toHaveBeenCalledWith("diabetes", { limit: 10 });
    });

    it("degrada a configured:false sin llamar la API si no está configurada", async () => {
      mockedConfigured.mockReturnValue(false);

      const caller = cie11Router.createCaller(makeCtx({}));
      const r = await caller.buscar({ q: "diabetes" });

      expect(r).toEqual({ configured: false, items: [] });
      expect(mockedBuscar).not.toHaveBeenCalled();
    });

    it("degrada a configured:false si el cliente lanza WhoIcdNotConfiguredError", async () => {
      mockedConfigured.mockReturnValue(true);
      mockedBuscar.mockRejectedValue(new WhoIcdNotConfiguredError());

      const caller = cie11Router.createCaller(makeCtx({}));
      const r = await caller.buscar({ q: "diabetes" });

      expect(r).toEqual({ configured: false, items: [] });
    });

    it("lanza BAD_GATEWAY ante un error inesperado de la API", async () => {
      mockedConfigured.mockReturnValue(true);
      mockedBuscar.mockRejectedValue(new Error("503 Service Unavailable"));

      const caller = cie11Router.createCaller(makeCtx({}));
      await expect(caller.buscar({ q: "diabetes" })).rejects.toMatchObject({
        code: "BAD_GATEWAY",
      });
    });

    it("rechaza query de menos de 2 caracteres", async () => {
      mockedConfigured.mockReturnValue(true);
      const caller = cie11Router.createCaller(makeCtx({}));
      await expect(caller.buscar({ q: "d" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
