// @vitest-environment jsdom
/**
 * Tests unitarios — Modo Offline PWA (US.F2.6.48)
 *
 * Cobertura:
 *  1-4:   db.ts — getDb, markSyncTimestamp, getLastSyncTimestamp, isExpired
 *  5-9:   sync-queue.ts — enqueue, getPendingItems, getFailedItems, replayQueue, retryItem
 * 10-12:  sync-queue.ts — backoffMs, clearFailedItems, conflict handling
 * 13-15:  cache-strategies.ts — cacheShiftData, getIndicacionesCached, getMedicamentoCached
 * 16-19:  online-status.ts — getOnlineStatus, subscribeOnlineStatus, getOfflineDurationMs
 *
 * Mock de IndexedDB: fake-indexeddb (inyecta polyfill IDB completo).
 * Se resetea el IndexedDB global y el singleton de db.ts entre tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
// Importar auto ANTES que cualquier uso de IndexedDB — inyecta el polyfill
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// Asegurar que crypto.randomUUID esté disponible en jsdom
import { webcrypto } from "node:crypto";
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// Reset IndexedDB y singleton de DB antes de cada test
beforeEach(async () => {
  // Nuevo IDBFactory aislado por test
  globalThis.indexedDB = new IDBFactory();
  // Resetear singleton de db.ts
  const { _resetDbForTests } = await import("../db");
  _resetDbForTests();
});

// ─── db.ts ───────────────────────────────────────────────────────────────────

describe("db.ts", () => {
  it("1. getDb retorna una instancia de IDB válida", async () => {
    const { getDb } = await import("../db");
    const db = await getDb();
    expect(db).toBeDefined();
    expect(typeof db.get).toBe("function");
    expect(typeof db.put).toBe("function");
  });

  it("2. markSyncTimestamp persiste el timestamp", async () => {
    const { markSyncTimestamp, getLastSyncTimestamp } = await import("../db");
    await markSyncTimestamp("test_tabla");
    const ts = await getLastSyncTimestamp("test_tabla");
    expect(ts).not.toBeNull();
    expect(typeof ts).toBe("number");
    expect(ts!).toBeGreaterThan(0);
  });

  it("3. getLastSyncTimestamp retorna null si nunca se ha sincronizado", async () => {
    const { getLastSyncTimestamp } = await import("../db");
    const ts = await getLastSyncTimestamp("tabla_inexistente");
    expect(ts).toBeNull();
  });

  it("4. isExpired detecta correctamente TTL vencido y vigente", async () => {
    const { isExpired } = await import("../db");
    const ahora = Date.now();
    const haceUnaHora = ahora - 60 * 60 * 1000 - 1;
    const haceUnMinuto = ahora - 60 * 1000;

    expect(isExpired(haceUnaHora, 60 * 60 * 1000)).toBe(true);
    expect(isExpired(haceUnMinuto, 60 * 60 * 1000)).toBe(false);
  });
});

// ─── sync-queue.ts ───────────────────────────────────────────────────────────

describe("sync-queue.ts — enqueue y lectura", () => {
  it("5. enqueue agrega un item con status PENDING_SYNC y retorna id_local UUID", async () => {
    const { enqueue, getPendingItems } = await import("../sync-queue");
    const id = await enqueue({ tipo: "administrationRecord", payload: { test: true } });

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const pending = await getPendingItems();
    expect(pending).toHaveLength(1);
    const item0 = pending[0]!;
    expect(item0.id_local).toBe(id);
    expect(item0.status).toBe("PENDING_SYNC");
    expect(item0.intentos).toBe(0);
  });

  it("6. getPendingItems retorna items ordenados por created_at ascendente", async () => {
    const { enqueue, getPendingItems } = await import("../sync-queue");
    await enqueue({ tipo: "validate5Correctos", payload: { order: 1 } });
    await new Promise((r) => setTimeout(r, 5));
    await enqueue({ tipo: "administrationRecord", payload: { order: 2 } });

    const pending = await getPendingItems();
    expect(pending).toHaveLength(2);
    expect(pending[0]!.created_at).toBeLessThanOrEqual(pending[1]!.created_at);
  });

  it("7. getFailedItems retorna solo items con status FAILED", async () => {
    const { enqueue, getFailedItems } = await import("../sync-queue");
    const { getDb, STORE } = await import("../db");

    const id = await enqueue({ tipo: "statOverride", payload: {} });

    // Simular fallo directo en DB
    const db = await getDb();
    const item = await db.get(STORE.SYNC_QUEUE, id);
    if (item) {
      await db.put(STORE.SYNC_QUEUE, {
        ...item,
        status: "FAILED",
        intentos: 5,
        error_message: "max retries",
      });
    }

    const failed = await getFailedItems();
    expect(failed).toHaveLength(1);
    const f0 = failed[0]!;
    expect(f0.status).toBe("FAILED");
    expect(f0.error_message).toBe("max retries");
  });
});

describe("sync-queue.ts — replayQueue", () => {
  it("8. replayQueue llama al endpoint y marca como synced en éxito", async () => {
    const { enqueue, replayQueue, getPendingItems } = await import("../sync-queue");
    await enqueue({ tipo: "administrationRecord", payload: { indicationId: "test" } });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
      text: async () => "ok",
    });

    const result = await replayQueue();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);

    // Item eliminado de la cola tras sync exitoso
    const remaining = await getPendingItems();
    expect(remaining).toHaveLength(0);
  });

  it("9. replayQueue detecta conflicto 409 y marca item como FAILED con conflicts", async () => {
    const { enqueue, replayQueue, getFailedItems } = await import("../sync-queue");
    await enqueue({ tipo: "administrationRecord", payload: { indicationId: "dup" } });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: "ya administrada" }),
      text: async () => "conflict",
    });

    const result = await replayQueue();
    expect(result.conflicts).toHaveLength(1);
    expect(result.failed).toBe(1);

    const failed = await getFailedItems();
    expect(failed[0]!.error_message).toContain("409");
  });

  it("10. backoffMs implementa exponential backoff correctamente", async () => {
    const { backoffMs } = await import("../sync-queue");
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(4)).toBe(8000);
    expect(backoffMs(5)).toBe(16000);
    // Cap a 30s
    expect(backoffMs(10)).toBe(30000);
  });

  it("11. después de MAX_RETRIES fallos, item queda como FAILED", async () => {
    const { enqueue, replayQueue, getFailedItems, MAX_RETRIES } = await import("../sync-queue");

    await enqueue({ tipo: "administrationRecord", payload: {} });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    // Simular MAX_RETRIES intentos fallidos
    for (let i = 0; i < MAX_RETRIES; i++) {
      await replayQueue();
    }

    const failed = await getFailedItems();
    expect(failed).toHaveLength(1);
    const f = failed[0]!;
    expect(f.intentos).toBeGreaterThanOrEqual(MAX_RETRIES);
    expect(f.status).toBe("FAILED");
  });

  it("12. clearFailedItems elimina todos los items FAILED", async () => {
    const { enqueue, getFailedItems, clearFailedItems } = await import("../sync-queue");
    const { getDb, STORE } = await import("../db");

    const id = await enqueue({ tipo: "statOverride", payload: {} });
    const db = await getDb();
    const item = await db.get(STORE.SYNC_QUEUE, id);
    if (item) {
      await db.put(STORE.SYNC_QUEUE, {
        ...item,
        status: "FAILED",
        intentos: 5,
        error_message: "x",
      });
    }

    expect(await getFailedItems()).toHaveLength(1);
    await clearFailedItems();
    expect(await getFailedItems()).toHaveLength(0);
  });
});

// ─── cache-strategies.ts ─────────────────────────────────────────────────────

describe("cache-strategies.ts", () => {
  it("13. cacheShiftData persiste indicaciones, pacientes y medicamentos", async () => {
    const { cacheShiftData, getIndicacionesCached, getPacientesCached } =
      await import("../cache-strategies");

    await cacheShiftData({
      indicaciones: [
        {
          indicationId: "ind-1",
          patientId: "pat-1",
          patientGsrn: "GSRN123",
          gtinMedicamento: "04006381",
          horaProgramada: Date.now() + 3600000,
          status: "PENDING",
        },
      ],
      pacientes: [
        { patientId: "pat-1", gsrn: "GSRN123", nombre: "Juan Pérez", habitacion: "101A" },
      ],
      medicamentos: [{ gtin: "04006381", nombre: "Paracetamol", presentacion: "500mg" }],
    });

    const inds = await getIndicacionesCached();
    expect(inds).not.toBeNull();
    expect(inds).toHaveLength(1);
    expect(inds![0]!.indicationId).toBe("ind-1");

    const pacs = await getPacientesCached();
    expect(pacs).not.toBeNull();
    expect(pacs![0]!.nombre).toBe("Juan Pérez");
  });

  it("14. getIndicacionesCached retorna null si cache expirado (TTL vencido)", async () => {
    const { cacheShiftData, getIndicacionesCached } = await import("../cache-strategies");
    const { getDb, STORE } = await import("../db");

    await cacheShiftData({
      indicaciones: [
        {
          indicationId: "ind-old",
          patientId: "pat-1",
          patientGsrn: null,
          gtinMedicamento: null,
          horaProgramada: null,
          status: "PENDING",
        },
      ],
      pacientes: [],
      medicamentos: [],
    });

    // Simular TTL vencido: poner timestamp hace 2 horas
    const db = await getDb();
    await db.put(STORE.LAST_SYNC, {
      tabla: "shift_data",
      synced_at: Date.now() - 2 * 60 * 60 * 1000,
    });

    const result = await getIndicacionesCached();
    expect(result).toBeNull();
  });

  it("15. getMedicamentoCached retorna null si GTIN no existe", async () => {
    const { getMedicamentoCached } = await import("../cache-strategies");
    const result = await getMedicamentoCached("GTIN_INEXISTENTE");
    expect(result).toBeNull();
  });
});

// ─── online-status.ts ────────────────────────────────────────────────────────

describe("online-status.ts", () => {
  it("16. getOnlineStatus retorna online cuando navigator.onLine = true", async () => {
    const { getOnlineStatus } = await import("../online-status");
    Object.defineProperty(globalThis.navigator, "onLine", {
      writable: true,
      configurable: true,
      value: true,
    });
    expect(getOnlineStatus()).toBe("online");
  });

  it("17. getOnlineStatus retorna offline cuando navigator.onLine = false", async () => {
    const { getOnlineStatus } = await import("../online-status");
    Object.defineProperty(globalThis.navigator, "onLine", {
      writable: true,
      configurable: true,
      value: false,
    });
    expect(getOnlineStatus()).toBe("offline");
  });

  it("18. subscribeOnlineStatus retorna función de cleanup que remueve listeners", async () => {
    const { subscribeOnlineStatus } = await import("../online-status");
    const addSpy = vi.spyOn(globalThis.window, "addEventListener");
    const removeSpy = vi.spyOn(globalThis.window, "removeEventListener");

    const cleanup = subscribeOnlineStatus(() => undefined);
    expect(addSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    cleanup();
    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("19. getOfflineDurationMs retorna 0 si offlineSince es null", async () => {
    const { getOfflineDurationMs } = await import("../online-status");
    expect(getOfflineDurationMs(null)).toBe(0);
  });

  it("20. getOfflineDurationMs retorna duración correcta en ms", async () => {
    const { getOfflineDurationMs } = await import("../online-status");
    const hace30min = Date.now() - 30 * 60 * 1000;
    const duracion = getOfflineDurationMs(hace30min);
    expect(duracion).toBeGreaterThanOrEqual(30 * 60 * 1000 - 100);
    expect(duracion).toBeLessThan(31 * 60 * 1000);
  });
});
