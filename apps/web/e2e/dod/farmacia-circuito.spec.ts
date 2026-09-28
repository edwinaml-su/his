/**
 * E2E — DoD Code Castle (docs/46_gobierno_de_producto.md §5): circuito
 * completo de farmacia para un proceso crítico (P0/P1 en docs/44):
 *
 *   prescribe → firma → farmacia valida lote/stock → dispensa →
 *   enfermería identifica paciente → escanea (BCMA) → administra → eMAR →
 *   auditoría
 *
 * más ≥1 escenario negativo/hard-stop, sin `test.skip`/`fixme` condicional
 * (regla explícita del punto 3 del DoD unificado).
 *
 * Rutas/routers reales ejercitados (ninguno mockeado, salvo donde se anota):
 *   1. /ece/indicaciones/nueva (CPOE, indicaciones-medicas.router.ts
 *      create+firmar) → dispara, en la MISMA transacción de la firma:
 *        - mar-consumer.ts (cola R04 ece.indicacion_farmacia_pendiente)
 *        - prescription-consumer.ts (ADR 0023: auto-genera
 *          public.Prescription + PrescriptionItem con drugId real, y
 *          auto-concilia la fila de la cola a RECONCILIADO)
 *   2. /pharmacy/dispense + /pharmacy/dispense/[orderId]
 *      (dispensation.router.ts reserveItem) → valida GTIN+lote contra
 *      StockItem/StockLot REALES (R07) y descuenta inventario atómicamente.
 *   3. /bedside/[patientId]/[indicationId] (bedside.router.ts
 *      validate5Correctos + administration.record) → identifica paciente
 *      por GSRN de pulsera, enfermera por GSRN de badge, medicamento por
 *      DataMatrix GS1 — BCMA.
 *   4. /ece/kardex/[patientId] (eMAR).
 *   5. /audit (audit.listByEntity — Prescription está en el array
 *      `audited_phase2` de packages/database/sql/22_audit_triggers_phase2.sql).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HALLAZGO BLOQUEANTE (confirmado leyendo código + verificado contra el
 * stack real, no solo análisis estático) — reportado a @PO/@Orq, NO
 * corregido en esta sesión (requiere @DBA, cruza ≥2 routers):
 *
 * El paso 3 (bedside.router.ts, función interna `runValidate5Correctos`,
 * sección "Paso 3: Medicamento correcto") compara el GTIN escaneado del
 * DataMatrix contra `ece.indicacion_item.descripcion` — un campo de TEXTO
 * LIBRE que el CPOE real (ModalMedicamento, esta misma carpeta
 * `_components/modal-medicamento.tsx`) rellena con un string legible para
 * humanos ("Cefotax QA · 1000 mg · IV · c/8h · cantidad a cargar 1 · P.U.
 * pendiente..."), NUNCA con un GTIN crudo de 14 dígitos.
 *
 * `ece.indicacion_item` SÍ tiene desde SQL 211 (CC-0026 Ola 2) una columna
 * `drug_id` estructurada — y `prescription-consumer.ts` la usa correctamente
 * para generar la `Prescription`/`PrescriptionItem` real (ver arriba, punto
 * 1). Pero `bedside.router.ts` Paso 3 NUNCA fue migrado a usar `drug_id` —
 * sigue comparando contra `descripcion`, un mecanismo más antiguo (ver su
 * propio comentario "FIX (resurrección E2E bedside-hard-stops, 2026-09)").
 * Y `public."Drug"` tampoco tiene columna `gtin` (confirmado en
 * schema.prisma) — el mismo gap que `dispensation.router.ts` documenta en
 * su propio comentario de `scanItem` Paso 4 ("Con Drug.gtin disponible
 * (futura dependencia @DBA)... Pendiente").
 *
 * Consecuencia: NINGUNA indicación prescrita por el CPOE real puede pasar
 * jamás el chequeo "medicamento correcto" del wizard bedside — el GTIN
 * escaneado (siempre 14 dígitos) nunca es igual al texto libre de
 * `descripcion`. El ÚNICO motivo por el que
 * `apps/web/e2e/fase2/bedside-hard-stops.spec.ts` tiene un caso feliz que
 * pasa es que `seed-e2e-fixtures.mjs` §5 siembra
 * `ece.indicacion_item.descripcion = GTIN_AMOXICILINA500` DIRECTO por SQL
 * (un atajo de fixture, nunca producido por ningún flujo de producto real)
 * — confirmado leyendo ese seeder línea por línea.
 *
 * Este spec NO repite ese atajo: la indicación se crea y firma por la UI
 * real (`test 1`), así que el escaneo del medicamento CORRECTAMENTE
 * prescrito y dispensado (`test 3`) hard-stopea con `MEDICAMENTO_NO_COINCIDE`
 * en vez de completar la administración. Por eso `test 3` y `test 4`
 * (que depende de que la administración exista) se dejan en rojo — no se
 * usa `test.skip`/`fixme` para maquillarlos, y no se "hace trampa" sembrando
 * `descripcion=GTIN` para forzar el verde.
 *
 * Fix correcto (fuera de alcance de esta sesión QA, requiere @DBA + tocar
 * ≥2 routers): agregar `Drug.gtin` (o una tabla puente Drug↔GTIN, dado que
 * un Drug puede tener varias presentaciones/GTIN) y migrar tanto
 * `bedside.router.ts` (Paso 3) como `dispensation.router.ts` (`scanItem`
 * Paso 4, que HOY tampoco valida el GTIN contra el ítem de receta — toma
 * `prescription.items[0]` a ciegas) a resolver el medicamento por
 * `drug_id`/`Drug.gtin` en vez de texto libre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SEGUNDO HALLAZGO BLOQUEANTE (2026-09-28, revisión @QA independiente) —
 * `test 1` TAMBIÉN queda en rojo, y por una razón distinta a la de arriba:
 *
 * `indicaciones-medicas.router.ts` `eceIds()` devuelve `ctx.user.id` DIRECTO
 * como `personalId` en vez de resolver la fila `ece.personal_salud` real vía
 * `requirePersonalSalud` (identity-resolver.ts) — esos dos espacios de id
 * NUNCA coinciden (ver el comentario de cabecera de identity-resolver.ts).
 * `personalId` se INSERTa en `indicaciones_medicas.medico_prescriptor`, FK a
 * `ece.personal_salud(id)` (sql/61_ece_06_documentos.sql:194): la firma real
 * de CUALQUIER médico revienta con 23503. Un intento anterior de esta misma
 * sesión "arregló" esto sembrando en `seed-e2e-fixtures.mjs` una fila
 * `ece.personal_salud` con `id = User.id` — un segundo revisor lo marcó
 * `major` porque, además de no reflejar cómo se resuelve esto en prod,
 * rompía la unicidad de `his_user_id` (creaba una SEGUNDA fila con el mismo
 * `his_user_id` que la ya sembrada arriba) y volvía no-determinista a
 * cualquier otro router que resuelva `personal_salud` por `his_user_id`. Se
 * revirtió (ver el comentario en ese archivo) — `test 1` queda en rojo
 * reportando el bug real, en vez de verde por un atajo que rompía otras
 * specs. Reportado como P0 a @PO/@Orq: fix correcto es migrar `eceIds()` a
 * `requirePersonalSalud(tx, ctx.user.id)`, en su propio PR de producto.
 *
 * Consecuencia en cascada (esperada, no un bug de este spec): con `test 1`
 * en rojo, `test 2` y `test 3` (que resuelven su precondición por API, no
 * por closure — ver el describe principal) fallan también al no encontrar
 * la Prescription/indicación que `test 1` debía haber creado. `test 4` y
 * `test 5` siguen corriendo (no usan `test.describe.serial()`) y reportan su
 * propio resultado real.
 *
 * Fixtures dedicados: packages/database/scripts/seed-e2e-fixtures.mjs §8
 * (namespace `e2ef3000`) / apps/web/e2e/_helpers/fixtures.ts
 * `E2E_DOD_FARMACIA`. A diferencia de `E2E_FIXTURES.indicationId` (atajo de
 * conciliación pre-sembrada), aquí SOLO se siembra lo que ningún flujo de
 * producto puede crear: paciente, episodio, cama, pulsera GSRN y catálogo
 * de fármacos + inventario (2 lotes: uno con stock real, otro con
 * `quantityOnHand=0` para el hard stop).
 */
import { test, expect, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { E2E_DOD_FARMACIA, E2E_GS1 } from "../_helpers/fixtures";
import { trpcQuery } from "../_helpers/trpc";

// ---------------------------------------------------------------------------
// Helpers (mismo mecanismo que fase2/bedside-hard-stops.spec.ts — ver el
// razonamiento completo en el header de ese archivo: `.fill()` no dispara
// `keydown`, así que el guard anti-tecleo-manual de scan-step.tsx (elapsed
// <= 80ms) se cumple trivialmente, igual que un scan real de pistola HID).
// ---------------------------------------------------------------------------

async function scan(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).fill(value);
}

/** DataMatrix GS1 RAW (sin paréntesis) — ver parseGs1String / apps/web/src/lib/gs1/parse-ai.ts. */
function dataMatrix(gtin: string, lote: string, vencimientoYYMMDD: string) {
  return `01${gtin}10${lote}\x1D17${vencimientoYYMMDD}`;
}

interface EceIndicacionRow {
  id: string;
  estado_registro: string;
}

interface PrescriptionListRow {
  id: string;
  status: string;
  items: Array<{ id: string; drug: { genericName: string } }>;
}

/** Abre el modal de categoría "med", busca por término único y selecciona el único resultado. */
async function agregarMedicamento(
  page: Page,
  opts: { searchTerm: string; dosis: string; via: string; frecuencia: string },
) {
  await page.getByTestId("btn-agregar-med").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByTestId("med-search").fill(opts.searchTerm);
  // El término de búsqueda es único en el catálogo E2E (Cefotaxima DoD /
  // Vancomicina DoD) — un solo resultado, click directo sin matchear texto
  // (el botón muestra brandName si existe, no genericName).
  await dialog.getByTestId("med-results").getByRole("button").first().click();

  await dialog.getByLabel(/dosis \(cantidad\)/i).fill(opts.dosis);
  await dialog.getByLabel(/^vía/i).click();
  await page.getByRole("option", { name: opts.via, exact: true }).click();
  await dialog.getByLabel(/^frecuencia/i).click();
  await page.getByRole("option", { name: opts.frecuencia, exact: true }).click();

  await dialog.getByTestId("btn-agregar-al-cuadro").click();
  await expect(dialog).toBeHidden();
}

/**
 * Si el episodio ya tiene una indicación firmada previa (otro test de este
 * mismo archivo corrió antes — mismo episodio, `workers:1`), el tipo pasa a
 * SUBSECUENTE y el subtipo por defecto es "Indicación diaria" (exige las 8
 * categorías completas). Forzamos "Indicación rápida" cuando el selector de
 * subtipo está presente; si la indicación es INICIAL (primer test), el
 * selector no existe y esto es un no-op.
 */
async function forzarIndicacionRapidaSiAplica(page: Page) {
  const subtipoTrigger = page.getByLabel(/subtipo de indicación subsecuente/i);
  if ((await subtipoTrigger.count()) > 0) {
    await subtipoTrigger.click();
    await page.getByRole("option", { name: "Indicación rápida" }).click();
  }
}

async function firmarYEsperarToast(page: Page) {
  await page.getByTestId("btn-firmar-indicacion").click();
  // El toast (Radix) deja también una región de notificaciones live con el
  // mismo texto — mismo patrón que la tarjeta oculta de login (ver
  // _helpers/auth.ts) — `.first()` evita el strict-mode violation, cualquiera
  // de los 2 nodos confirma que la firma tuvo éxito.
  await expect(page.getByText(/indicación firmada/i).first()).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Circuito principal (@dod)
// ---------------------------------------------------------------------------

test.describe("@dod - Circuito de farmacia completo", () => {
  // `retries: 0` (sobre-escribe el global de playwright.config.ts) — hallazgo
  // @QA (2026-09-28): cada test resuelve su propia precondición por API en
  // vez de leer un closure de JS llenado por un test anterior (ver debajo),
  // así que un retry de CUALQUIER test de este describe volvería a ejecutar
  // su UI completa (prescribir, firmar, dispensar...) y crearía indicaciones/
  // Prescriptions DUPLICADAS para el mismo paciente/episodio — el `.find()`
  // de cada resolución por API dejaría de ser unívoco y el locator `li` de
  // los pasos de UI (dispensa, bedside) podría violar el modo estricto de
  // Playwright. `workers:1` ya da orden secuencial dentro del archivo; NO se
  // usa `test.describe.serial()` a propósito: si el paso 3 falla (hallazgo
  // documentado arriba), el paso 5 (auditoría de la Prescription, que no
  // depende de la administración) debe poder seguir corriendo y reportar su
  // propio resultado real — `serial` saltaría automáticamente TODO lo que
  // sigue a la primera falla, lo cual rompería esa garantía.
  test.describe.configure({ retries: 0 });

  test("1. Médico prescribe y firma una indicación con medicamento estructurado (ADR 0023 auto-genera la Prescription)", async ({
    page,
  }) => {
    await login(page, "physician");
    await page.goto(`/ece/indicaciones/nueva?episodioId=${E2E_DOD_FARMACIA.episodioId}`);
    await expect(page.getByRole("heading", { name: /nueva indicación médica/i })).toBeVisible();

    await agregarMedicamento(page, {
      searchTerm: E2E_DOD_FARMACIA.drugA.searchTerm,
      dosis: "1000",
      via: "IV",
      frecuencia: "c/8h",
    });
    // Justo antes de firmar (no al cargar la página): `eceIndicaciones.list`
    // (que decide INICIAL vs SUBSECUENTE) es async — si se corre esta
    // condición demasiado pronto, el selector de subtipo puede no existir
    // aún aunque el episodio SÍ tenga una firma previa (reintento de este
    // mismo test, u orden de ejecución con el hard stop de abajo).
    await forzarIndicacionRapidaSiAplica(page);
    await firmarYEsperarToast(page);

    // La UI solo redirige a /ece/indicaciones tras el toast — no expone el
    // id de la indicación ni de la Prescription generada. Se resuelven por
    // API con la MISMA sesión (cookies compartidas vía page.request), no
    // por atajo a BD (instrucción explícita del REQ).
    const list = await trpcQuery<{ items: EceIndicacionRow[] }>(page.request, "eceIndicaciones.list", {
      episodioId: E2E_DOD_FARMACIA.episodioId,
      limit: 20,
    });
    expect(list.ok, `eceIndicaciones.list falló: ${list.errorMessage}`).toBeTruthy();
    const firmada = list.data?.items.find((i) => i.estado_registro === "firmado");
    expect(firmada, "la indicación recién creada debió quedar en estado 'firmado'").toBeTruthy();

    const rx = await trpcQuery<PrescriptionListRow[]>(page.request, "pharmacy.prescription.list", {
      patientId: E2E_DOD_FARMACIA.patientId,
    });
    expect(rx.ok, `pharmacy.prescription.list falló: ${rx.errorMessage}`).toBeTruthy();
    const generated = rx.data?.find((p) =>
      p.items.some((it) => it.drug.genericName === E2E_DOD_FARMACIA.drugA.genericName),
    );
    expect(
      generated,
      "ADR 0023 (prescription-consumer.ts) debió auto-generar Prescription+PrescriptionItem al firmar " +
        "la indicación con drug_id estructurado — si esto falla, el punto único de prescripción está roto.",
    ).toBeTruthy();
    expect(generated!.status).toBe("SIGNED");
    // NO se guarda en una variable de módulo para que la lean los tests 2/3:
    // cada test resuelve su propia precondición por API (hallazgo @QA
    // 2026-09-28, ver comentario de `retries: 0` arriba) — un `test.skip`
    // condicional sobre un closure se vuelve "flaky" en vez de "failed"
    // cuando Playwright reintenta el test 3 en un worker nuevo (estado de
    // módulo reseteado) tras el hard stop documentado más abajo.
  });

  test("2. Farmacia valida lote/stock real (inventario) y dispensa vía escaneo GS1", async ({ page }) => {
    await login(page, "admin"); // rol PHARM en el seed (ver pharmacy-cart.spec.ts)

    // Precondición resuelta por API (no closure del test 1 — ver comentario
    // de `retries: 0` arriba). Si el paso 1 no generó la Prescription (p.ej.
    // por el bug de identidad de `eceIds()` documentado en
    // seed-e2e-fixtures.mjs), esto falla con un mensaje explícito en vez de
    // saltarse en silencio.
    const rx = await trpcQuery<PrescriptionListRow[]>(page.request, "pharmacy.prescription.list", {
      patientId: E2E_DOD_FARMACIA.patientId,
    });
    expect(rx.ok, `pharmacy.prescription.list falló: ${rx.errorMessage}`).toBeTruthy();
    const generated = rx.data?.find((p) =>
      p.items.some((it) => it.drug.genericName === E2E_DOD_FARMACIA.drugA.genericName),
    );
    expect(generated, "requiere la Prescription generada en el paso 1 — no se encontró vía API").toBeTruthy();
    const prescriptionIdA = generated!.id;

    await page.goto("/pharmacy/dispense");
    await expect(page.getByRole("heading", { name: /picking/i })).toBeVisible();

    const row = page.locator("li").filter({ hasText: "Circuito DoD" }).filter({ hasText: "Cefotaxima" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: /iniciar dispensaci/i }).click();
    await expect(page).toHaveURL(new RegExp(`/pharmacy/dispense/${prescriptionIdA}`));

    await page.locator("#gs1-gtin").fill(E2E_DOD_FARMACIA.drugA.gtin);
    await page.locator("#gs1-lote").fill(E2E_DOD_FARMACIA.drugA.lote);
    await page.getByRole("button", { name: /validar y reservar/i }).click();

    // Éxito real = banner "reserva activa" (dispensation.reserveItem validó
    // StockItem/StockLot REALES — el lote se sembró con quantityOnHand=5,
    // AVAILABLE — y descontó inventario atómicamente, R07).
    await expect(page.getByText(/reserva activa/i)).toBeVisible({ timeout: 10_000 });
  });

  test("3. Enfermería identifica al paciente, escanea BCMA y administra el medicamento prescrito", async ({
    page,
  }) => {
    await login(page, "nurse");

    // Precondición resuelta por API (no closure del test 1 — ver comentario
    // de `retries: 0` en el describe). `clinicalProcedure` (PHYSICIAN/MC/
    // NURSE/ENF) cubre a "nurse" para `eceIndicaciones.list`.
    const list = await trpcQuery<{ items: EceIndicacionRow[] }>(page.request, "eceIndicaciones.list", {
      episodioId: E2E_DOD_FARMACIA.episodioId,
      limit: 20,
    });
    expect(list.ok, `eceIndicaciones.list falló: ${list.errorMessage}`).toBeTruthy();
    const firmada = list.data?.items.find((i) => i.estado_registro === "firmado");
    expect(firmada, "requiere la indicación firmada en el paso 1 — no se encontró vía API").toBeTruthy();
    const indicacionId = firmada!.id;

    await page.goto(`/bedside/${E2E_DOD_FARMACIA.patientId}/${indicacionId}`);
    await expect(page).toHaveURL(/\/bedside\//);

    await scan(page, "bedside-scan-patient", E2E_DOD_FARMACIA.gsrnPaciente);
    await scan(page, "bedside-scan-nurse", E2E_GS1.gsrnEnfermera);
    await scan(
      page,
      "bedside-scan-medication",
      dataMatrix(E2E_DOD_FARMACIA.drugA.gtin, E2E_DOD_FARMACIA.drugA.lote, "301231"),
    );

    // COMPORTAMIENTO CORRECTO que este test afirma: el medicamento escaneado
    // es EXACTAMENTE el prescrito (paso 1) y dispensado (paso 2) para este
    // paciente — el wizard debería completar la administración BCMA.
    //
    // Se espera que esta aserción FALLE hoy: el hard stop
    // MEDICAMENTO_NO_COINCIDE dispara porque bedside.router.ts compara el
    // GTIN contra `ece.indicacion_item.descripcion` (texto libre del CPOE),
    // no contra el `drug_id`/GTIN real — ver el hallazgo documentado en el
    // header de este archivo. No se usa `test.skip`/`fixme`: el rojo aquí
    // ES la evidencia del hallazgo, reportado como bloqueante a @PO/@Orq.
    await expect(page.getByTestId("administration-success")).toBeVisible({ timeout: 8_000 });
  });

  test("4. El Kardex (eMAR) del paciente refleja la administración con BCMA verificado", async ({ page }) => {
    // Depende de que el paso 3 haya creado la MedicationAdministration —
    // consecuencia esperada del mismo hallazgo (no se salta el test: si
    // algún día el paso 3 se arregla, este debe empezar a pasar sin tocarlo).
    await login(page, "admin");
    await page.goto(`/ece/kardex/${E2E_DOD_FARMACIA.patientId}`);
    await expect(page.getByRole("heading", { name: /kardex de administraciones/i })).toBeVisible();

    await expect(page.getByText(E2E_DOD_FARMACIA.drugA.genericName)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/verificado/i).first()).toBeVisible();
  });

  test("5. La Prescription generada al firmar queda en la cadena de auditoría", async ({ page }) => {
    // Independiente del paso 3: la Prescription se crea (y audita) al firmar
    // la indicación (paso 1), sin importar si luego se administra. Resuelve
    // el id por su cuenta (no reutiliza la variable `prescriptionIdA` del
    // paso 1) — un test de auditoría no debe depender de closures de JS
    // entre `test()` para su precondición real; la fuente de verdad es la
    // API, con la MISMA sesión (login propio de este test).
    await login(page, "admin");
    const rx = await trpcQuery<PrescriptionListRow[]>(page.request, "pharmacy.prescription.list", {
      patientId: E2E_DOD_FARMACIA.patientId,
    });
    expect(rx.ok, `pharmacy.prescription.list falló: ${rx.errorMessage}`).toBeTruthy();
    const generated = rx.data?.find((p) =>
      p.items.some((it) => it.drug.genericName === E2E_DOD_FARMACIA.drugA.genericName),
    );
    expect(generated, "requiere la Prescription auto-generada en el paso 1 — corrió éste solo?").toBeTruthy();
    const prescriptionId = generated!.id;

    await page.goto("/audit");
    await page.getByLabel(/entidad/i).fill("Prescription");
    await page.getByLabel(/^id$/i).fill(prescriptionId);
    await page.getByRole("button", { name: /consultar/i }).click();

    await expect(page.getByText(/^(CREATE|UPDATE)$/).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(prescriptionId).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Negativo / hard-stop real (no mockeado): dispensar sin stock bloquea.
// ---------------------------------------------------------------------------

test.describe("@dod - Hard stop real: dispensar sin stock bloquea", () => {
  test("farmacia no puede reservar un lote con inventario agotado (STOCK_INSUFICIENTE)", async ({
    page,
    browser,
  }) => {
    // 1. Prescribe + firma Drug B (mismo paciente/episodio — lote sembrado
    //    con quantityOnHand=0 a propósito, seed §8).
    await login(page, "physician");
    await page.goto(`/ece/indicaciones/nueva?episodioId=${E2E_DOD_FARMACIA.episodioId}`);
    await expect(page.getByRole("heading", { name: /nueva indicación médica/i })).toBeVisible();

    await agregarMedicamento(page, {
      searchTerm: E2E_DOD_FARMACIA.drugB.searchTerm,
      dosis: "500",
      via: "IV",
      frecuencia: "c/8h",
    });
    // Ver comentario equivalente en el test 1: se hace justo antes de firmar.
    await forzarIndicacionRapidaSiAplica(page);
    await firmarYEsperarToast(page);

    const rx = await trpcQuery<PrescriptionListRow[]>(page.request, "pharmacy.prescription.list", {
      patientId: E2E_DOD_FARMACIA.patientId,
    });
    expect(rx.ok, `pharmacy.prescription.list falló: ${rx.errorMessage}`).toBeTruthy();
    const generated = rx.data?.find((p) =>
      p.items.some((it) => it.drug.genericName === E2E_DOD_FARMACIA.drugB.genericName),
    );
    expect(generated, "ADR 0023 debió auto-generar la Prescription de Vancomicina DoD E2E").toBeTruthy();
    const prescriptionIdB = generated!.id;

    // 2. Farmacia intenta dispensar — el lote sembrado tiene
    //    quantityOnHand=0 desde el inicio (sin descuento previo necesario:
    //    hard stop real de dispensation.router.ts validateAndDecrementStock
    //    en el PRIMER intento, sin mocks).
    //
    // Contexto de NAVEGADOR nuevo (no solo `context.newPage()`): una página
    // nueva del MISMO `context` comparte cookies con `page` — la sesión de
    // physician seguiría activa, /login redirigiría de inmediato al
    // dashboard (guard de sesión) y el formulario de email/password nunca
    // se renderizaría (`login()` cuelga 60s esperando un campo que no va a
    // aparecer — confirmado empíricamente: `context.newPage()` solo no
    // alcanza). `browser.newContext()` sí aísla cookies/storage, como un
    // perfil de navegador distinto para el farmacéutico.
    const pharmacyContext = await browser.newContext();
    const pharmacyPage = await pharmacyContext.newPage();
    await login(pharmacyPage, "admin");
    await pharmacyPage.goto("/pharmacy/dispense");
    const row = pharmacyPage.locator("li").filter({ hasText: "Circuito DoD" }).filter({ hasText: "Vancomicina" });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: /iniciar dispensaci/i }).click();
    await expect(pharmacyPage).toHaveURL(new RegExp(`/pharmacy/dispense/${prescriptionIdB}`));

    await pharmacyPage.locator("#gs1-gtin").fill(E2E_DOD_FARMACIA.drugB.gtin);
    await pharmacyPage.locator("#gs1-lote").fill(E2E_DOD_FARMACIA.drugB.lote);
    await pharmacyPage.getByRole("button", { name: /validar y reservar/i }).click();

    const hardStop = pharmacyPage.getByRole("alert").filter({ hasText: "HARD STOP" });
    await expect(hardStop).toBeVisible({ timeout: 10_000 });
    await expect(hardStop).toContainText("STOCK_INSUFICIENTE");
    await expect(hardStop).toContainText(/no hay existencias del lote escaneado/i);

    // El bloqueo es real: nunca se creó la reserva.
    await expect(pharmacyPage.getByText(/reserva activa/i)).toBeHidden();
    await pharmacyContext.close();
  });
});
