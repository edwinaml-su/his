/**
 * Tests de schemas de auditoría organizacional.
 */
import { describe, it, expect } from "vitest";
import {
  auditActionSchema,
  auditEntityKindSchema,
  listOrgChangesInputSchema,
  auditLogEntrySchema,
  listOrgChangesResultSchema,
} from "../audit";

const u = "00000000-0000-0000-0000-000000000001";

describe("auditActionSchema", () => {
  it.each(["CREATE", "READ", "UPDATE", "DELETE", "SIGN", "BREAK_GLASS", "SYSTEM_ERROR"])(
    "acepta accion %s",
    (a) => expect(auditActionSchema.safeParse(a).success).toBe(true),
  );

  it("rechaza accion desconocida", () => {
    expect(auditActionSchema.safeParse("HACK").success).toBe(false);
  });
});

describe("auditEntityKindSchema", () => {
  it.each(["Organization", "Establishment", "ALL"])("acepta %s", (k) => {
    expect(auditEntityKindSchema.safeParse(k).success).toBe(true);
  });
  it("rechaza entidad desconocida", () => {
    expect(auditEntityKindSchema.safeParse("User").success).toBe(false);
  });
});

describe("listOrgChangesInputSchema", () => {
  it("acepta input vacio con defaults", () => {
    const result = listOrgChangesInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entityKind).toBe("ALL");
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it("acepta filtros completos", () => {
    const result = listOrgChangesInputSchema.safeParse({
      organizationId: u,
      entityKind: "Organization",
      action: "UPDATE",
      userId: u,
      from: "2025-01-01",
      to: "2025-12-31",
      page: 2,
      pageSize: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza pageSize mayor a 100", () => {
    expect(listOrgChangesInputSchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  it("rechaza page menor a 1", () => {
    expect(listOrgChangesInputSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it("rechaza organizationId no-uuid", () => {
    expect(listOrgChangesInputSchema.safeParse({ organizationId: "bad" }).success).toBe(false);
  });
});

describe("auditLogEntrySchema", () => {
  it("acepta DTO minimo valido", () => {
    const entry = {
      id: "1",
      occurredAt: new Date(),
      userId: null,
      userLabel: null,
      organizationId: null,
      action: "UPDATE",
      entity: "Patient",
      entityId: null,
      beforeJson: null,
      afterJson: null,
      changedFields: ["name"],
      justification: null,
    };
    expect(auditLogEntrySchema.safeParse(entry).success).toBe(true);
  });
});

describe("listOrgChangesResultSchema", () => {
  it("acepta resultado vacio", () => {
    const result = listOrgChangesResultSchema.safeParse({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    expect(result.success).toBe(true);
  });
});
