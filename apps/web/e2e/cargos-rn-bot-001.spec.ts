/**
 * E2E — RN-HIS-BOT-001 (docs/48 C5-2): las 8 pruebas de aceptación de
 * `docs/47_rn_his_bot_001_botiquin_cargos.md` §4, como specs contra la app
 * real.
 *
 * Circuito bajo prueba (ya construido, docs/48 Olas 1-4b — ver
 * docs/qa/drhis/RN-HIS-BOT-001-reverificacion-post-remediacion.md):
 *   `dispensation.reserveItem`/`scanItem` (packages/trpc/src/routers/
 *   pharmacy/dispensation.router.ts) capturan el cargo con `capturarCargo`
 *   (packages/trpc/src/lib/charge-capture.ts) en la MISMA transacción que el
 *   descuento de inventario — precio resuelto server-side vía
 *   `resolverPrecio` (price-resolver.ts) y congelado (priceListId/
 *   priceRuleId/resolvedAt/priceSource). `cancelReservation` revierte el
 *   cargo (nunca lo borra). `patientAccount.cerrar` bloquea con causas.
 *
 * Fixtures: packages/database/scripts/seed-e2e-fixtures.mjs §7 — 7
 * escenarios dedicados (1 paciente+cuenta+receta+lote GS1 por prueba, ids en
 * apps/web/e2e/_helpers/fixtures.ts E2E_BOT). No se reutiliza un paciente
 * entre pruebas: `resolverCuentaActiva` cae a "la cuenta activa MÁS
 * RECIENTE del paciente" cuando no hay match de encounterId — dos cuentas
 * del mismo paciente romperían el aislamiento entre pruebas.
 *
 * Aserciones: acción real de UI (login + navegar a /pharmacy/dispense/
 * [orderId] + escanear GTIN/lote + "Validar y reservar"/"Cancelar reserva")
 * + lectura de la respuesta real de esa mutación (`page.waitForResponse`) +
 * `patientAccount.listarPorPaciente`/`cerrar`/`regularizar` por API
 * (`page.request`, mismas cookies de sesión que la UI — ver
 * apps/web/e2e/_helpers/trpc.ts). La UI de dispensación NO renderiza precio
 * en pantalla (verificado leyendo dispense/[orderId]/page.tsx) — por eso las
 * aserciones de negocio de precio leen la respuesta de red, no el DOM.
 *
 * Tags: las pruebas sobre PRECIO (#1, #2, #3, #4, #8 — resolución/
 * congelamiento de tarifa) llevan `@smoke` (docs/48 lo pide textual) y
 * corren en cada PR contra el stack efímero. Devolución (#6) y emergencia
 * (#7) son de flujo/estado de cuenta, no de precio — sin tag, corren en
 * `e2e.yml` nightly. #5 (entrega parcial) es `test.fixme` — ver esa prueba.
 */
import { test, expect, type Page } from "@playwright/test";
import { login } from "./_helpers/auth";
import { E2E_BOT } from "./_helpers/fixtures";
import { trpcMutate, trpcQuery, parseTrpcResponse, decimalToNumber } from "./_helpers/trpc";

// ---------------------------------------------------------------------------
// Tipos mínimos de las respuestas que este spec necesita leer.
// ---------------------------------------------------------------------------

interface CargoCapturado {
  cargoId: string;
  status: "VIGENTE" | "PENDIENTE_TARIFA";
  unitPrice: number | string | null;
}

interface ReserveItemData {
  id: string; // PharmacyReservation.id
  cargo: CargoCapturado;
}

interface CargoLinea {
  id: string;
  accountId: string;
  status: string;
  code: string | null;
  descripcion: string | null;
  unitPrice: unknown;
  totalPrice: unknown;
  quantity: unknown;
  priceListId: string | null;
  priceRuleId: string | null;
  resolvedAt: string | null;
  priceSource: string | null;
  origen: string | null;
  referenciaId: string | null;
  reversalOfId: string | null;
}

interface CuentaConServicios {
  id: string;
  status: string;
  tipoCuentaId: string | null;
  servicios: CargoLinea[];
}

// ---------------------------------------------------------------------------
// Helpers de la spec
// ---------------------------------------------------------------------------

/**
 * Navega a la estación real de dispensación, escanea GTIN/lote y hace click
 * en "Validar y reservar" — la MISMA acción que ejecuta un farmacéutico real.
 * Devuelve la respuesta real de `dispensation.reserveItem` (con el `cargo`
 * capturado server-side), decodificada.
 *
 * Espera a que el <select> de medicamento muestre el nombre del fármaco
 * ANTES de escanear: la página auto-selecciona el único ítem de la receta
 * en un `useEffect` tras cargar `orderDetail` — sin esta espera, el submit
 * podría dispararse con `prescriptionItemId` aún vacío (falla de validación
 * de cliente, no del negocio que este spec quiere probar).
 */
async function dispensar(
  page: Page,
  opts: { prescriptionId: string; gtin: string; lote: string; drugName: string },
) {
  await page.goto(`/pharmacy/dispense/${opts.prescriptionId}`);
  await expect(page.locator("#gs1-item")).toContainText(opts.drugName, { timeout: 8_000 });

  await page.locator("#gs1-gtin").fill(opts.gtin);
  await page.locator("#gs1-lote").fill(opts.lote);

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("dispensation.reserveItem") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /validar y reservar/i }).click();
  const response = await responsePromise;
  return parseTrpcResponse<ReserveItemData>(response);
}

/** `patientAccount.listarPorPaciente` por API — misma sesión que la UI. */
async function cuentasDelPaciente(page: Page, patientId: string): Promise<CuentaConServicios[]> {
  const { data, ok, errorMessage } = await trpcQuery<CuentaConServicios[]>(
    page.request,
    "patientAccount.listarPorPaciente",
    { patientId },
  );
  expect(ok, `patientAccount.listarPorPaciente falló: ${errorMessage}`).toBeTruthy();
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("RN-HIS-BOT-001 — pruebas de aceptación de cargos a cuenta (docs/47 §4)", () => {
  // requireRole(["PHARM","ADMIN"]) en reserveItem/cancelReservation + ADMIN/
  // ACCOUNTANT en cerrar/regularizar/addRule — "admin" cubre las 4 sin
  // depender de un usuario PHARM dedicado que no existe en TEST_CREDENTIALS.
  // R9 (segregación): el prescriptor sembrado es qa.physician@his.test, no
  // qa.admin@his.test — dispensar como admin nunca choca con esa regla.
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("@smoke 1. ISBM: dispensar resuelve precio de lista ISBM con lista/regla/fecha registrados", async ({
    page,
  }) => {
    const s = E2E_BOT.isbm;
    const reserva = await dispensar(page, {
      prescriptionId: s.prescriptionId,
      gtin: s.gtin,
      lote: s.lote,
      drugName: s.drugName,
    });

    expect(reserva.ok, reserva.errorMessage ?? "").toBeTruthy();
    expect(reserva.data?.cargo.status).toBe("VIGENTE");
    expect(decimalToNumber(reserva.data?.cargo.unitPrice)).toBeCloseTo(12.5, 2);

    const [cuenta] = await cuentasDelPaciente(page, s.patientId);
    const cargo = cuenta?.servicios.find((sv) => sv.id === reserva.data?.cargo.cargoId);
    expect(cargo, "la línea de cargo debe existir en la cuenta").toBeTruthy();
    // "lista y fecha de tarifa registradas" (docs/47) — congelamiento R4.
    expect(cargo?.priceListId).toBe(E2E_BOT.priceLists.isbm);
    expect(cargo?.resolvedAt, "fecha de tarifa (resolvedAt)").toBeTruthy();
    // Este escenario resuelve por ServicePriceRule (no ítem plano) — cubre
    // el camino "regla" del resolver, además de "lista".
    expect(cargo?.priceRuleId, "regla aplicada (priceRuleId)").toBeTruthy();
    expect(cargo?.priceSource).toBe("regla");
    expect(decimalToNumber(cargo?.unitPrice)).toBeCloseTo(12.5, 2);
  });

  test("@smoke 2. MAPFRE: precio de la lista del tipo de cuenta, no el particular", async ({ page }) => {
    const s = E2E_BOT.mapfre;
    const reserva = await dispensar(page, {
      prescriptionId: s.prescriptionId,
      gtin: s.gtin,
      lote: s.lote,
      drugName: s.drugName,
    });

    expect(reserva.ok, reserva.errorMessage ?? "").toBeTruthy();
    expect(reserva.data?.cargo.status).toBe("VIGENTE");
    expect(decimalToNumber(reserva.data?.cargo.unitPrice)).toBeCloseTo(18.75, 2);

    const [cuenta] = await cuentasDelPaciente(page, s.patientId);
    const cargo = cuenta?.servicios.find((sv) => sv.id === reserva.data?.cargo.cargoId);
    // La cuenta está anclada a TipoCuenta MAPFRE_TEST → lista MAPFRE, nunca
    // la lista default/particular de la org (docs/47: "no el particular").
    expect(cargo?.priceListId).toBe(E2E_BOT.priceLists.mapfre);
    expect(cargo?.priceListId).not.toBe(E2E_BOT.priceLists.default);
    expect(cargo?.priceSource).toBe("lista");
    expect(cargo?.resolvedAt).toBeTruthy();
  });

  test("@smoke 3. DoctorSV: tipo de cuenta permitido y tarifa resuelta en el punto de atención", async ({
    page,
  }) => {
    const s = E2E_BOT.doctorsv;
    const reserva = await dispensar(page, {
      prescriptionId: s.prescriptionId,
      gtin: s.gtin,
      lote: s.lote,
      drugName: s.drugName,
    });

    // "La requisición debe PERMITIR el tipo de cuenta DoctorSV" — la
    // dispensación real (no solo el catálogo administrativo) tiene que
    // aceptar esta cuenta sin rechazo.
    expect(reserva.ok, reserva.errorMessage ?? "").toBeTruthy();
    expect(reserva.data?.cargo.status).toBe("VIGENTE");
    expect(decimalToNumber(reserva.data?.cargo.unitPrice)).toBeCloseTo(9.99, 2);

    const [cuenta] = await cuentasDelPaciente(page, s.patientId);
    expect(cuenta?.tipoCuentaId).toBe(E2E_BOT.tiposCuenta.doctorsv);
    const cargo = cuenta?.servicios.find((sv) => sv.id === reserva.data?.cargo.cargoId);
    expect(cargo?.priceListId).toBe(E2E_BOT.priceLists.doctorsv);
  });

  test("@smoke 4. Sin precio resoluble ⇒ línea PENDIENTE_TARIFA (nunca 0) y cierre bloqueado", async ({
    page,
  }) => {
    const s = E2E_BOT.sinPrecio;
    const reserva = await dispensar(page, {
      prescriptionId: s.prescriptionId,
      gtin: s.gtin,
      lote: s.lote,
      drugName: s.drugName,
    });

    // Dispensa igual (R3: nunca se bloquea la entrega por falta de tarifa) —
    // pero el cargo queda pendiente, nunca en $0.
    expect(reserva.ok, reserva.errorMessage ?? "").toBeTruthy();
    expect(reserva.data?.cargo.status).toBe("PENDIENTE_TARIFA");
    expect(reserva.data?.cargo.unitPrice).toBeNull();

    const [cuenta] = await cuentasDelPaciente(page, s.patientId);
    const cargo = cuenta?.servicios.find((sv) => sv.id === reserva.data?.cargo.cargoId);
    expect(cargo?.status).toBe("PENDIENTE_TARIFA");
    expect(cargo?.unitPrice).toBeNull();
    expect(cargo?.totalPrice).toBeNull();
    expect(cargo?.priceListId).toBeNull();

    // Cierre de cuenta bloqueado mientras la línea siga PENDIENTE_TARIFA.
    // Nota: `patientAccount.cerrar` arma el detalle de causas en
    // `cause: { causas }` (patient-account.router.ts) pero el
    // `errorFormatter` de packages/trpc/src/trpc.ts solo reenvía
    // `zodError`/`interactionAlerts` al cliente — la causa específica
    // ("CARGOS_PENDIENTE_TARIFA") NO llega al wire hoy. Se infiere por
    // aislamiento de fixture (esta cuenta no tiene ninguna otra causa
    // posible) — ver hallazgo en el reporte de @QA.
    const cierre = await trpcMutate(page.request, "patientAccount.cerrar", {
      accountId: s.accountId,
    });
    expect(cierre.ok).toBe(false);
    expect(cierre.errorCode).toBe("PRECONDITION_FAILED");
  });

  test("5. Entrega parcial 5 de 10 ⇒ cargo por 5, pendiente por 5", async () => {
    // R6 (cantidad entregada vs. solicitada) NO fue parte del alcance de
    // docs/48 — confirmado sin cambios en la re-verificación @DrHIS
    // (docs/qa/drhis/RN-HIS-BOT-001-reverificacion-post-remediacion.md,
    // fila R6 de la matriz R1-R13: "No cumple (sin cambios)"). El modelo de
    // dispensación GS1 real es unidad-por-escaneo: `capturarCargo` siempre
    // recibe `quantity: 1` (hardcodeado en dispensation.router.ts:569,773),
    // no existe un input de "cantidad entregada" distinto de "cantidad
    // solicitada" en `reserveItem`/`scanItem`. No hay UI ni API que
    // produzca "cargo por 5, pendiente por 5" hoy — automatizar esta
    // prueba requeriría construir el feature primero (R6), no solo el test.
    test.fixme(
      true,
      "R6 (cantidad entregada vs. solicitada) fuera del alcance de docs/48 — modelo GS1 es unidad-por-escaneo, sin campo de cantidad parcial en reserveItem/scanItem. Ver docs/qa/drhis/RN-HIS-BOT-001-reverificacion-post-remediacion.md fila R6.",
    );
  });

  test("6. Devolución ⇒ reingreso al mismo lote y línea REVERSION negativa enlazada, original nunca borrada", async ({
    page,
  }) => {
    const s = E2E_BOT.devolucion;
    await page.goto(`/pharmacy/dispense/${s.prescriptionId}`);
    await expect(page.locator("#gs1-item")).toContainText(s.drugName, { timeout: 8_000 });
    await page.locator("#gs1-gtin").fill(s.gtin);
    await page.locator("#gs1-lote").fill(s.lote);

    const reservePromise = page.waitForResponse(
      (r) => r.url().includes("dispensation.reserveItem") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /validar y reservar/i }).click();
    const reserva = await parseTrpcResponse<ReserveItemData>(await reservePromise);
    expect(reserva.ok, reserva.errorMessage ?? "").toBeTruthy();
    const cargoOriginalId = reserva.data!.cargo.cargoId;

    // Devolución real: click en "Cancelar reserva" (banner de reserva
    // activa) → motivo → "Confirmar cancelación". Misma acción que un
    // farmacéutico ejecutaría para procesar la devolución del paciente.
    await expect(page.getByText(/reserva activa/i)).toBeVisible();
    await page.getByRole("button", { name: "Cancelar reserva" }).click();
    await page.locator("#cancel-motivo").fill("Devolución E2E — orden médica suspendida");

    const cancelPromise = page.waitForResponse(
      (r) => r.url().includes("dispensation.cancelReservation") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /confirmar cancelación/i }).click();
    const cancelacion = await parseTrpcResponse(await cancelPromise);
    expect(cancelacion.ok, cancelacion.errorMessage ?? "").toBeTruthy();
    // Banner de reserva activa desaparece — confirmación visible en UI.
    await expect(page.getByText(/reserva activa/i)).not.toBeVisible();

    const [cuenta] = await cuentasDelPaciente(page, s.patientId);
    const original = cuenta?.servicios.find((sv) => sv.id === cargoOriginalId);
    const reversion = cuenta?.servicios.find((sv) => sv.reversalOfId === cargoOriginalId);

    // El original nunca se borra — solo cambia de estado.
    expect(original, "el cargo original sigue existiendo").toBeTruthy();
    expect(original?.status).toBe("REVERTIDO");
    // Línea REVERSION enlazada, con cantidad/total negativos (mismo lote,
    // mismo unitPrice — solo el signo cambia).
    expect(reversion, "debe existir una línea REVERSION enlazada por reversalOfId").toBeTruthy();
    expect(reversion?.status).toBe("REVERSION");
    expect(decimalToNumber(reversion?.quantity)).toBeLessThan(0);
    expect(decimalToNumber(reversion?.totalPrice)).toBeLessThan(0);
    expect(reversion?.descripcion).toContain("Devolución E2E");
  });

  test("7. Emergencia sin pagador ⇒ dispensa igual; cuenta no cierra hasta regularizar", async ({ page }) => {
    const s = E2E_BOT.emergencia;

    // Precondición del fixture: la cuenta abre PENDIENTE_REGULARIZAR sin
    // tipoCuentaId (seed-e2e-fixtures.mjs §7) — el estado real que produce
    // patientAccount.crear({ emergenciaSinPagador: true }).
    let [cuenta] = await cuentasDelPaciente(page, s.patientId);
    expect(cuenta?.status).toBe("PENDIENTE_REGULARIZAR");
    expect(cuenta?.tipoCuentaId).toBeNull();

    const reserva = await dispensar(page, {
      prescriptionId: s.prescriptionId,
      gtin: s.gtin,
      lote: s.lote,
      drugName: s.drugName,
    });
    // "Se dispensa igual" — PENDIENTE_REGULARIZAR es un estado ACTIVO para
    // capturarCargo (ESTADOS_CUENTA_ACTIVA), no un hard-stop.
    expect(reserva.ok, reserva.errorMessage ?? "").toBeTruthy();
    expect(reserva.data?.cargo.status).toBe("VIGENTE");
    expect(decimalToNumber(reserva.data?.cargo.unitPrice)).toBeCloseTo(5.0, 2); // lista DEFAULT (isDefault=true)

    // La cuenta NO cierra hasta regularizar.
    const cierreBloqueado = await trpcMutate(page.request, "patientAccount.cerrar", {
      accountId: s.accountId,
    });
    expect(cierreBloqueado.ok).toBe(false);
    expect(cierreBloqueado.errorCode).toBe("PRECONDITION_FAILED");

    // Regularizar (rol ADMIN/ACCOUNTANT) resuelve la causa — se le asigna
    // un tipo de cuenta real (reusa ISBM_TEST, cualquier tipo válido sirve).
    const regularizar = await trpcMutate(page.request, "patientAccount.regularizar", {
      accountId: s.accountId,
      tipoCuentaId: E2E_BOT.tiposCuenta.isbm,
    });
    expect(regularizar.ok, regularizar.errorMessage ?? "").toBeTruthy();

    [cuenta] = await cuentasDelPaciente(page, s.patientId);
    expect(cuenta?.status).toBe("ABIERTA");

    // Ahora sí cierra — el único bloqueo era el pagador sin definir; el
    // cargo capturado arriba tiene movimiento de inventario (mismo tx que
    // reserveItem) y su propia línea, así que no dispara los otros 4 causas.
    const cierreFinal = await trpcMutate<{ status: string }>(page.request, "patientAccount.cerrar", {
      accountId: s.accountId,
    });
    expect(cierreFinal.ok, cierreFinal.errorMessage ?? "").toBeTruthy();
    expect(cierreFinal.data?.status).toBe("CERRADA");
  });

  test("@smoke 8. Cambio de tarifario hoy ⇒ cargos de ayer conservan su precio original", async ({
    page,
  }) => {
    const s = E2E_BOT.tarifaHoy;

    // "Ayer": la regla sembrada (dateStart=ayer, $15.00) ya está vigente.
    const cargoAyer = await dispensar(page, {
      prescriptionId: s.prescriptionId,
      gtin: s.gtin,
      lote: s.lote,
      drugName: s.drugName,
    });
    expect(cargoAyer.ok, cargoAyer.errorMessage ?? "").toBeTruthy();
    expect(decimalToNumber(cargoAyer.data?.cargo.unitPrice)).toBeCloseTo(15.0, 2);
    const cargoAyerId = cargoAyer.data!.cargo.cargoId;

    let [cuenta] = await cuentasDelPaciente(page, s.patientId);
    const antes = cuenta?.servicios.find((sv) => sv.id === cargoAyerId);
    expect(antes?.priceListId).toBe(E2E_BOT.priceLists.isbm);
    const resolvedAtAntes = antes?.resolvedAt;
    const priceRuleIdAntes = antes?.priceRuleId;

    // "Hoy": cambio de tarifario por la API REAL de administración
    // (servicePriceList.addRule, rol ADMIN/ACCOUNTANT) — docs/48 C1-4: la
    // nueva regla auto-cierra la vigencia de la anterior con el MISMO
    // itemCode (dateEnd = dateStart de la nueva), no un UPDATE manual a BD.
    const nuevaRegla = await trpcMutate(page.request, "servicePriceList.addRule", {
      priceListId: E2E_BOT.priceLists.isbm,
      appliedOn: "item",
      itemCode: s.code,
      minQuantity: 0,
      computePrice: "fixed",
      fixedPrice: 25.0,
      percentPrice: 0,
      base: "list_price",
      priceDiscount: 0,
      priceSurcharge: 0,
      priceRound: 0,
      priceMinMargin: 0,
      priceMaxMargin: 0,
      sequence: 0,
      dateStart: new Date().toISOString(),
    });
    expect(nuevaRegla.ok, nuevaRegla.errorMessage ?? "").toBeTruthy();

    // Nueva dispensación del MISMO lote (quantityOnHand=20 en el seed
    // alcanza para 2+) → debe resolver contra la regla nueva.
    const cargoHoy = await dispensar(page, {
      prescriptionId: s.prescriptionId,
      gtin: s.gtin,
      lote: s.lote,
      drugName: s.drugName,
    });
    expect(cargoHoy.ok, cargoHoy.errorMessage ?? "").toBeTruthy();
    expect(decimalToNumber(cargoHoy.data?.cargo.unitPrice)).toBeCloseTo(25.0, 2);

    // El cargo de AYER no se reescribe — sigue congelado con el precio,
    // regla y fecha originales (RN R4).
    [cuenta] = await cuentasDelPaciente(page, s.patientId);
    const despues = cuenta?.servicios.find((sv) => sv.id === cargoAyerId);
    expect(decimalToNumber(despues?.unitPrice)).toBeCloseTo(15.0, 2);
    expect(despues?.resolvedAt).toBe(resolvedAtAntes);
    expect(despues?.priceRuleId).toBe(priceRuleIdAntes);
  });
});
