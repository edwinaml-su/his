#!/usr/bin/env node
/**
 * CC-0016 — Seed del catálogo de 292 prestaciones de radiología e imágenes
 * (docs/CC/0016/mockup_modulo_imagenes.html) por organización real.
 *
 * Por cada organización real (legalName NOT LIKE 'RLS-Test%'):
 *   - upsert 5 "LabPanel" area RADIOLOGIA (codes IMG-ESP/IMG-RX/IMG-RM/IMG-TAC/
 *     IMG-USG) — idempotente por (organizationId, code).
 *   - upsert 292 "LabTest" (code = PREF+correlativo pad-3, specimen OTHER,
 *     standardPrice NULL) — idempotente por (organizationId, code).
 *   - upsert su "ImagingTestAttrs" derivado (contraste/ayuno/autorización/
 *     duración/modalityType; modalityId/preparación NULL en el seed inicial).
 *
 * La derivación (RAW/regex/códigos) vive en ./lib/imagenes-catalogo-derivacion.mjs
 * (testeada sin BD en scripts/__tests__/imagenes-catalogo-derivacion.test.mjs).
 *
 * Prerrequisito: SQL 192_cc0016_modulo_imagenes.sql ya aplicado (crea
 * ImagingTestAttrs y desactiva el catálogo global AVT-RAD-%).
 *
 * Uso:
 *   node --env-file=.env.local packages/database/scripts/seed-imagenes-catalogo.mjs --dry-run
 *   node --env-file=.env.local packages/database/scripts/seed-imagenes-catalogo.mjs
 *
 * IMPORTANTE: el agente que generó este script (@Dev/@DBA) solo tiene
 * autorizado correr --dry-run. La corrida real la ejecuta el orquestador.
 */

import { construirCatalogo, CATS } from "./lib/imagenes-catalogo-derivacion.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

const PANEL_CODE = { esp: "IMG-ESP", rx: "IMG-RX", rm: "IMG-RM", tac: "IMG-TAC", usg: "IMG-USG" };
const PANEL_NAME = {
  esp: "Estudios Especiales",
  rx: "Radiografías",
  rm: "Resonancia Magnética",
  tac: "Tomografías",
  usg: "Ultrasonografías",
};

function construirPaneles() {
  return CATS.map((c) => ({
    code: PANEL_CODE[c.id],
    name: PANEL_NAME[c.id],
    displayOrder: c.displayOrder,
    catId: c.id,
  }));
}

/**
 * "LabPanel" no tiene UNIQUE(organizationId, code) a nivel BD (mismo hallazgo
 * documentado en 189_cc0013 — solo @@index([code])), así que no admite
 * `ON CONFLICT`. Se resuelve con upsert manual (find-then-create/update).
 */
async function upsertPanelManual(prisma, organizationId, panel) {
  const existing = await prisma.labPanel.findFirst({
    where: { organizationId, code: panel.code },
    select: { id: true },
  });
  if (existing) {
    await prisma.labPanel.update({
      where: { id: existing.id },
      data: { name: panel.name, displayOrder: panel.displayOrder, active: true },
    });
    return existing.id;
  }
  const created = await prisma.labPanel.create({
    data: {
      organizationId,
      code: panel.code,
      name: panel.name,
      area: "RADIOLOGIA",
      displayOrder: panel.displayOrder,
      active: true,
    },
    select: { id: true },
  });
  return created.id;
}

async function upsertTestManual(prisma, organizationId, panelId, item) {
  const existing = await prisma.labTest.findFirst({
    where: { organizationId, code: item.code },
    select: { id: true },
  });
  let testId;
  if (existing) {
    await prisma.labTest.update({
      where: { id: existing.id },
      data: { panelId, name: item.name, displayOrder: item.displayOrder, active: true },
    });
    testId = existing.id;
  } else {
    const created = await prisma.labTest.create({
      data: {
        organizationId,
        panelId,
        code: item.code,
        name: item.name,
        specimen: "OTHER",
        displayOrder: item.displayOrder,
        active: true,
      },
      select: { id: true },
    });
    testId = created.id;
  }

  await prisma.imagingTestAttrs.upsert({
    where: { labTestId: testId },
    create: {
      labTestId: testId,
      requiereContraste: item.contraste,
      requiereAyuno: item.ayuno,
      requiereAutorizacion: item.autorizacion,
      duracionMin: item.duracionMin,
      modalityType: item.modalityType,
    },
    update: {
      requiereContraste: item.contraste,
      requiereAyuno: item.ayuno,
      requiereAutorizacion: item.autorizacion,
      duracionMin: item.duracionMin,
      modalityType: item.modalityType,
    },
  });

  return testId;
}

async function runDryRun(catalogo, paneles) {
  console.log(`Catálogo derivado: ${catalogo.length} prestaciones en ${paneles.length} paneles.`);
  const byCat = {};
  for (const item of catalogo) byCat[item.cat] = (byCat[item.cat] ?? 0) + 1;
  for (const panel of paneles) {
    console.log(`  [${panel.code}] ${panel.name} — ${byCat[panel.catId] ?? 0} prestaciones`);
  }
  const contraste = catalogo.filter((i) => i.contraste).length;
  const ayuno = catalogo.filter((i) => i.ayuno).length;
  const autorizacion = catalogo.filter((i) => i.autorizacion).length;
  console.log(`\nContraste: ${contraste} | Ayuno: ${ayuno} | Autorización: ${autorizacion}`);

  console.log("\n--- Muestra (primeros 3 por panel) ---");
  for (const panel of paneles) {
    console.log(`  ${panel.name}:`);
    for (const item of catalogo.filter((i) => i.cat === panel.catId).slice(0, 3)) {
      console.log(
        `    [${item.code}] ${item.name} — ${item.duracionMin}min, modality=${item.modalityType}` +
          `${item.contraste ? ", contraste" : ""}${item.ayuno ? ", ayuno" : ""}${item.autorizacion ? ", autorización" : ""}`,
      );
    }
  }

  let prisma;
  try {
    const { PrismaClient } = await import("@his/database");
    prisma = new PrismaClient();
    const orgs = await prisma.organization.findMany({
      where: { NOT: { legalName: { startsWith: "RLS-Test" } } },
      select: { id: true, legalName: true },
    });
    console.log(`\n--- Dry-run contra BD: ${orgs.length} organizaciones reales ---`);
    for (const org of orgs) {
      console.log(`  ${org.legalName}: se crearían/actualizarían ${paneles.length} paneles + ${catalogo.length} prestaciones.`);
    }
    console.log(`\nTotal proyectado: ${orgs.length} orgs × ${catalogo.length} prestaciones = ${orgs.length * catalogo.length} filas LabTest`);
  } catch (err) {
    console.log(`\nNo se pudo validar contra BD (${err.message}). Validación en seco (solo derivación) completada arriba.`);
  } finally {
    await prisma?.$disconnect();
  }

  console.log("\nDRY-RUN completo. No se escribió nada.");
}

async function runReal(catalogo, paneles) {
  const { PrismaClient } = await import("@his/database");
  const prisma = new PrismaClient();
  try {
    const orgs = await prisma.organization.findMany({
      where: { NOT: { legalName: { startsWith: "RLS-Test" } } },
      select: { id: true, legalName: true },
    });
    console.log(`Organizaciones reales: ${orgs.length}`);

    let panelesCreados = 0;
    let testsUpserted = 0;

    for (const org of orgs) {
      const panelIdByCat = {};
      for (const panel of paneles) {
        panelIdByCat[panel.catId] = await upsertPanelManual(prisma, org.id, panel);
        panelesCreados++;
      }
      for (const item of catalogo) {
        await upsertTestManual(prisma, org.id, panelIdByCat[item.cat], item);
        testsUpserted++;
      }
      console.log(`  ${org.legalName}: ${paneles.length} paneles + ${catalogo.length} prestaciones procesadas.`);
    }

    console.log("\n--- Resumen ---");
    console.log(`Paneles creados/actualizados: ${panelesCreados}`);
    console.log(`Prestaciones (LabTest + ImagingTestAttrs) upserted: ${testsUpserted}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const catalogo = construirCatalogo();
  const paneles = construirPaneles();

  if (DRY_RUN) {
    await runDryRun(catalogo, paneles);
    return;
  }

  await runReal(catalogo, paneles);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export { construirPaneles };
