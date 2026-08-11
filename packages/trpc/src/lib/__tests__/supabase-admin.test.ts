/**
 * CC-0019 — tests del cliente admin de Supabase Auth vía REST (`fetch` mockeado).
 * Cubre: env no configurado, happy path de cada función, y errores HTTP.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createAuthUser,
  deleteAuthUser,
  generateAuthActionLink,
  SupabaseAdminNotConfiguredError,
  SupabaseAdminRequestError,
} from "../supabase-admin";

const ORIGINAL_ENV = { ...process.env };

function setEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
}

describe("supabase-admin", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  describe("env no configurado", () => {
    it("createAuthUser lanza SupabaseAdminNotConfiguredError sin service role key", async () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
      await expect(createAuthUser("a@b.com")).rejects.toBeInstanceOf(
        SupabaseAdminNotConfiguredError,
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it("generateAuthActionLink lanza SupabaseAdminNotConfiguredError sin URL", async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
      await expect(
        generateAuthActionLink({ type: "recovery", email: "a@b.com", redirectTo: "https://x/y" }),
      ).rejects.toBeInstanceOf(SupabaseAdminNotConfiguredError);
    });
  });

  describe("createAuthUser", () => {
    it("POST a /auth/v1/admin/users con email_confirm:true y sin password", async () => {
      setEnv();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "auth-uuid-1", email: "a@b.com" }),
      });

      const result = await createAuthUser("a@b.com");

      expect(result).toEqual({ id: "auth-uuid-1" });
      expect(fetch).toHaveBeenCalledWith(
        "https://project.supabase.co/auth/v1/admin/users",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            apikey: "test-service-role-key",
            Authorization: "Bearer test-service-role-key",
          }),
        }),
      );
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body).toEqual({ email: "a@b.com", email_confirm: true });
      expect(body.password).toBeUndefined();
    });

    it("lanza SupabaseAdminRequestError en HTTP no-ok", async () => {
      setEnv();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => "Email address already registered",
      });
      await expect(createAuthUser("dupe@b.com")).rejects.toBeInstanceOf(
        SupabaseAdminRequestError,
      );
    });

    it("lanza SupabaseAdminRequestError si la respuesta no trae id", async () => {
      setEnv();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      await expect(createAuthUser("a@b.com")).rejects.toBeInstanceOf(SupabaseAdminRequestError);
    });
  });

  describe("deleteAuthUser", () => {
    it("hace DELETE con el id", async () => {
      setEnv();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
      await deleteAuthUser("auth-uuid-1");
      expect(fetch).toHaveBeenCalledWith(
        "https://project.supabase.co/auth/v1/admin/users/auth-uuid-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("NUNCA lanza, ni con env no configurado ni con fetch fallando", async () => {
      // Sin setEnv() — readSupabaseAdminEnv lanzaría SupabaseAdminNotConfiguredError.
      await expect(deleteAuthUser("x")).resolves.toBeUndefined();

      setEnv();
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
      await expect(deleteAuthUser("x")).resolves.toBeUndefined();
    });
  });

  describe("generateAuthActionLink", () => {
    it("extrae action_link de la respuesta top-level", async () => {
      setEnv();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ action_link: "https://project.supabase.co/verify?token=abc" }),
      });
      const link = await generateAuthActionLink({
        type: "recovery",
        email: "a@b.com",
        redirectTo: "https://app.example/recover/reset",
      });
      expect(link).toBe("https://project.supabase.co/verify?token=abc");

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toBe("https://project.supabase.co/auth/v1/admin/generate_link");
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body).toEqual({
        type: "recovery",
        email: "a@b.com",
        redirect_to: "https://app.example/recover/reset",
      });
    });

    it("extrae action_link anidado en properties (forma alterna de la API)", async () => {
      setEnv();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ properties: { action_link: "https://x/verify?token=nested" } }),
      });
      const link = await generateAuthActionLink({
        type: "invite",
        email: "a@b.com",
        redirectTo: "https://app.example/recover/reset",
      });
      expect(link).toBe("https://x/verify?token=nested");
    });

    it("lanza SupabaseAdminRequestError si no hay action_link en la respuesta", async () => {
      setEnv();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      await expect(
        generateAuthActionLink({ type: "recovery", email: "a@b.com", redirectTo: "https://x/y" }),
      ).rejects.toBeInstanceOf(SupabaseAdminRequestError);
    });

    it("lanza SupabaseAdminRequestError en HTTP no-ok", async () => {
      setEnv();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "internal error",
      });
      await expect(
        generateAuthActionLink({ type: "recovery", email: "a@b.com", redirectTo: "https://x/y" }),
      ).rejects.toBeInstanceOf(SupabaseAdminRequestError);
    });
  });
});
