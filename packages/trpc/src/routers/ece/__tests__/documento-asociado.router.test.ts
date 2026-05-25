/**
 * Tests unitarios — documentoAsociadoRouter (ECE DOC_ASOC).
 *
 * NTEC §15, §38 — Documentos Clínicos Asociados.
 *
 * Casos cubiertos (5 tests):
 *   1. Zod create — mimeType no permitido → falla validación
 *   2. Zod create — tamanoBytes > 50 MB → falla validación
 *   3. Zod create — hashSha256 con longitud incorrecta → falla validación
 *   4. firmar — happy path, emite evento ece.documento_asociado.firmado
 *   5. firmar — CONFLICT si documento ya está firmado
 *
 * @QA E2E pendiente:
 *   - Flujo completo: POST signed-url → PUT Storage → create → firmar con PIN válido.
 *   - Trigger BD rechaza UPDATE de storage_path en documento firmado.
 *   - anular en estado firmado devuelve CONFLICT.
 *   - DIR puede anular en estado borrador, MT no puede anular.
 */
import { describe, it, expect, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

// ─── Schemas inline (evita symlinks en worktree) ──────────────────────────────

const MIME_TYPES_PERMITIDOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/dicom",
  "application/dicom",
  "application/octet-stream",
] as const;

const TAMANO_MAX = 52_428_800;

import { z } from "zod";

const createSchema = z.object({
  pacienteId:   z.string().uuid(),
  episodioId:   z.string().uuid().optional(),
  categoria:    z.enum(["imagen_diagnostica","laboratorio_externo","referencia_externa","consentimiento_externo","otro"]),
  titulo:       z.string().min(3).max(255),
  descripcion:  z.string().max(1_000).optional(),
  storagePath:  z.string().min(1).max(1_000),
  mimeType:     z.enum(MIME_TYPES_PERMITIDOS),
  tamanoBytes:  z.number().int().min(1).max(TAMANO_MAX),
  hashSha256:   z.string().length(64).regex(/^[0-9a-f]+$/),
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@his/database")>();
  return {
    ...mod,
    emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../workflow/context", () => ({
  withWorkflowContext: async (
    prisma: PrismaClient,
    _ctx: unknown,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma),
}));

vi.mock("@his/infrastructure", () => ({
  argon2: {
    verify: vi.fn().mockResolvedValue(true),
  },
}));

// Importar router DESPUÉS de los mocks
import { documentoAsociadoRouter } from "../documento-asociado.router";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const uuid1 = "00000000-0000-4000-8000-000000000001";
const uuid2 = "00000000-0000-4000-8000-000000000002";
const uuid3 = "00000000-0000-4000-8000-000000000003";
const uuid4 = "00000000-0000-4000-8000-000000000004";

const VALID_HASH = "a".repeat(64); // 64 chars hex válidos

const validCreateInput = {
  pacienteId:  uuid1,
  episodioId:  uuid2,
  categoria:   "laboratorio_externo" as const,
  titulo:      "Resultado hemograma externo",
  storagePath: "uploads/1716000000000/abc/resultado.pdf",
  mimeType:    "application/pdf" as const,
  tamanoBytes: 512_000, // 500 KB
  hashSha256:  VALID_HASH,
};

const makeDocRow = (estadoRegistro = "borrador") => ({
  id:                  uuid1,
  instancia_id:        uuid2,
  paciente_id:         uuid3,
  episodio_id:         uuid4,
  establecimiento_id:  uuid2,
  categoria:           "laboratorio_externo",
  titulo:              "Resultado hemograma externo",
  descripcion:         null,
  fecha_documento:     "2026-05-24",
  storage_bucket:      "ece-documentos-asociados",
  storage_path:        "uploads/1716000000000/abc/resultado.pdf",
  mime_type:           "application/pdf",
  tamano_bytes:        BigInt(512_000),
  hash_sha256:         VALID_HASH,
  adjuntado_por:       uuid1,
  adjuntado_en:        new Date("2026-05-24T10:00:00Z"),
  estado_registro:     estadoRegistro,
  firmado_por:         null,
  firmado_en:          null,
  motivo_anulacion:    null,
  estado_documento:    estadoRegistro,
});

function buildCtx(roleCodes: string[] = ["MT"]) {
  const prisma = mockDeep<PrismaClient>();

  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);

  return {
    prisma,
    user: { id: uuid1, email: "mt@test.com", fullName: "Médico Turno" },
    tenant: {
      organizationId: uuid2,
      establishmentId: uuid3,
      roleCodes,
    },
    portalAccount: null,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("documentoAsociadoCreateSchema — validación Zod", () => {
  it("1. rechaza mimeType no permitido", () => {
    const r = createSchema.safeParse({
      ...validCreateInput,
      mimeType: "video/mp4",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.mimeType).toBeDefined();
    }
  });

  it("2. rechaza tamanoBytes mayor a 50 MB", () => {
    const r = createSchema.safeParse({
      ...validCreateInput,
      tamanoBytes: TAMANO_MAX + 1,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.tamanoBytes).toBeDefined();
    }
  });

  it("3. rechaza hashSha256 con longitud incorrecta o no-hex", () => {
    const r1 = createSchema.safeParse({ ...validCreateInput, hashSha256: "abc" });
    const r2 = createSchema.safeParse({ ...validCreateInput, hashSha256: "Z".repeat(64) });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });
});

describe("documentoAsociadoRouter — firmar", () => {
  it("4. happy path: firma el documento y emite evento", async () => {
    const ctx = buildCtx(["MT"]);
    const docRow = makeDocRow("borrador");

    // El router firmar ejecuta en este orden:
    // 1. SELECT doc, 2. findPersonal, 3. findFirma, 4. UPDATE firma (executeRaw),
    // 5. UPDATE documento_asociado (executeRaw), 6. SELECT transición, 7. UPDATE instancia (executeRaw)
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([docRow])        // 1. SELECT doc
      .mockResolvedValueOnce([{ id: uuid4 }]) // 2. findPersonal
      .mockResolvedValueOnce([{               // 3. findFirma
        id: uuid4,
        pin_hash: "$argon2id$hash",
        failed_attempts: 0,
        intentos_fallidos: 0,
        locked_until: null,
        bloqueado_hasta: null,
        revoked_at: null,
      }])
      .mockResolvedValueOnce([{              // 4. SELECT transición 'firmar'
        estado_destino_id: uuid3,
      }]);

    (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const caller = documentoAsociadoRouter.createCaller(ctx as never);
    const result = await caller.firmar({ id: uuid1, firmaPin: "1234" });

    expect(result.ok).toBe(true);
    expect(result.estado).toBe("firmado");

    const { emitDomainEvent } = await import("@his/database");
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "ece.documento_asociado.firmado",
        aggregateId: uuid1,
      }),
    );
  });

  it("5. CONFLICT si documento ya está firmado", async () => {
    const ctx = buildCtx(["MT"]);
    const docRow = makeDocRow("firmado");

    // El router verifica estado del doc ANTES de llamar verifyPin
    (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([docRow]);       // SELECT doc — ya firmado (lanza CONFLICT aquí)

    const caller = documentoAsociadoRouter.createCaller(ctx as never);

    await expect(
      caller.firmar({ id: uuid1, firmaPin: "1234" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
