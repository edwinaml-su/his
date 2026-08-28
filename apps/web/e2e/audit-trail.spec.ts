/**
 * E2E — Audit trail.
 * US: AUD-01 (toda mutación queda registrada), AUD-02 (visor de auditoría).
 *
 * 2026-08-28: alineado a la UI actual — el visor /audit exige entidad + ID
 * (audit.listByEntity) y muestra userId, no email. La escritura auditada que
 * verificamos es el INSERT de las camas E2E (seed-e2e-fixtures.mjs), que
 * dispara audit.fn_audit_row (02_audit_triggers.sql, aplicado por el paso
 * "Bootstrap RLS helpers" del workflow) → fila CREATE en audit."AuditLog".
 * El flujo UI legacy (cambiar estado de cama desde /beds) ya no existe en la
 * página actual; la mutación UI→audit se cubrirá cuando /ece/camas deje de
 * usar SERVICIOS_MOCK.
 */
import { test, expect } from "@playwright/test";
import { login } from "./_helpers/auth";
import { E2E_FIXTURES } from "./_helpers/fixtures";

test.describe("@smoke - Audit trail", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("las escrituras sobre Bed quedan en audit log y se ven en el visor", async ({ page }) => {
    await page.goto("/audit");

    // Visor: buscar por entidad + ID (ambos obligatorios).
    await page.getByLabel(/entidad/i).fill("Bed");
    await page.getByLabel(/^id$/i).fill(E2E_FIXTURES.bedFreeId);
    await page.getByRole("button", { name: /consultar/i }).click();

    // Debe aparecer al menos el evento CREATE del seed de fixtures
    // (o UPDATE de corridas idempotentes posteriores).
    await expect(page.getByText(/^(CREATE|UPDATE)$/).first()).toBeVisible();
    // La columna ID muestra el uuid determinista de la cama E2E-01.
    await expect(page.getByText(E2E_FIXTURES.bedFreeId).first()).toBeVisible();
  });
});
