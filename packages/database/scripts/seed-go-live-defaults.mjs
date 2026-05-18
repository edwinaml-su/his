#!/usr/bin/env node
/**
 * Seed Go-Live Defaults — Inserta configuración base para producción Avante.
 *
 * Contenido:
 *   1. Roles base (public."Role") — MC, ENF, FARM, DIR, ADMIN, ADMIN_CLINICO,
 *      WORKFLOW_DESIGNER, PHYSICIAN, NURSE, PHARM
 *   2. Permisos base (public."Permission") — catálogo mínimo de acciones
 *   3. RolePermission — mapping conservador (lectura + acciones específicas)
 *   4. Organización demo Avante (public."Organization")
 *   5. Establecimiento principal (public."Establishment")
 *   6. gs1CompanyPrefix placeholder en la org Avante
 *   7. Plantillas workflow ECE (ece.workflow_plantilla) — las 6 base F2-S16
 *
 * Idempotente: re-ejecutable sin duplicar datos.
 * NO modifica usuarios existentes ni revoca permisos concedidos.
 *
 * Uso:
 *   node --env-file=.env packages/database/scripts/seed-go-live-defaults.mjs
 */

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

// ─── Catálogo de roles ────────────────────────────────────────────────────────

/**
 * Roles globales del sistema (organizationId = null).
 * @type {Array<{code:string, name:string, description:string}>}
 */
const ROLES = [
  { code: "MC",                 name: "Médico Cirujano",           description: "Médico tratante con facultad de prescripción y altas" },
  { code: "ENF",                name: "Enfermera/o",               description: "Personal de enfermería — ejecución de órdenes y triaje" },
  { code: "FARM",               name: "Farmacéutico/a",            description: "Dispensación, validación y control de medicamentos" },
  { code: "DIR",                name: "Director Médico",           description: "Dirección clínica y firma de documentos formales ECE" },
  { code: "ADMIN",              name: "Administrador Sistema",     description: "Acceso total a configuración y administración" },
  { code: "ADMIN_CLINICO",      name: "Administrador Clínico",    description: "Gestión de expedientes, usuarios y configuración clínica" },
  { code: "WORKFLOW_DESIGNER",  name: "Diseñador de Flujos",      description: "Creación y edición de plantillas workflow ECE" },
  { code: "PHYSICIAN",          name: "Physician",                 description: "Alias internacional de MC para integraciones externas" },
  { code: "NURSE",              name: "Nurse",                     description: "Alias internacional de ENF para integraciones externas" },
  { code: "PHARM",              name: "Pharmacist",                description: "Alias internacional de FARM para integraciones externas" },
];

// ─── Catálogo de permisos ─────────────────────────────────────────────────────

/**
 * Permisos atómicos (recurso + acción). Código = "<recurso>.<accion>".
 * @type {Array<{code:string, resource:string, action:string}>}
 */
const PERMISSIONS = [
  // Patient
  { code: "patient.read",          resource: "patient",          action: "read"       },
  { code: "patient.write",         resource: "patient",          action: "write"      },
  { code: "patient.delete",        resource: "patient",          action: "delete"     },
  // Encounter
  { code: "encounter.read",        resource: "encounter",        action: "read"       },
  { code: "encounter.write",       resource: "encounter",        action: "write"      },
  { code: "encounter.close",       resource: "encounter",        action: "close"      },
  // Prescription / RX
  { code: "rx.read",               resource: "rx",               action: "read"       },
  { code: "rx.write",              resource: "rx",               action: "write"      },
  { code: "rx.sign",               resource: "rx",               action: "sign"       },
  { code: "rx.dispense",           resource: "rx",               action: "dispense"   },
  // Lab
  { code: "lab.read",              resource: "lab",              action: "read"       },
  { code: "lab.order",             resource: "lab",              action: "order"      },
  { code: "lab.result",            resource: "lab",              action: "result"     },
  // Imaging
  { code: "imaging.read",          resource: "imaging",          action: "read"       },
  { code: "imaging.order",         resource: "imaging",          action: "order"      },
  { code: "imaging.report",        resource: "imaging",          action: "report"     },
  // Triage
  { code: "triage.read",           resource: "triage",           action: "read"       },
  { code: "triage.write",          resource: "triage",           action: "write"      },
  // Inpatient / Admission
  { code: "inpatient.read",        resource: "inpatient",        action: "read"       },
  { code: "inpatient.admit",       resource: "inpatient",        action: "admit"      },
  { code: "inpatient.discharge",   resource: "inpatient",        action: "discharge"  },
  // Surgery
  { code: "surgery.read",          resource: "surgery",          action: "read"       },
  { code: "surgery.write",         resource: "surgery",          action: "write"      },
  // Inventory
  { code: "inventory.read",        resource: "inventory",        action: "read"       },
  { code: "inventory.write",       resource: "inventory",        action: "write"      },
  // Reports / BI
  { code: "report.read",           resource: "report",           action: "read"       },
  { code: "report.export",         resource: "report",           action: "export"     },
  // Admin / Config
  { code: "admin.users",           resource: "admin",            action: "users"      },
  { code: "admin.roles",           resource: "admin",            action: "roles"      },
  { code: "admin.settings",        resource: "admin",            action: "settings"   },
  { code: "admin.audit",           resource: "admin",            action: "audit"      },
  // Workflow ECE
  { code: "workflow.read",         resource: "workflow",         action: "read"       },
  { code: "workflow.design",       resource: "workflow",         action: "design"     },
  { code: "workflow.publish",      resource: "workflow",         action: "publish"    },
  // Consent
  { code: "consent.read",          resource: "consent",          action: "read"       },
  { code: "consent.write",         resource: "consent",          action: "write"      },
  { code: "consent.sign",          resource: "consent",          action: "sign"       },
  // Death / Defuncion
  { code: "death.read",            resource: "death",            action: "read"       },
  { code: "death.write",           resource: "death",            action: "write"      },
  { code: "death.certify",         resource: "death",            action: "certify"    },
  // Vital Signs
  { code: "vitals.read",           resource: "vitals",           action: "read"       },
  { code: "vitals.write",          resource: "vitals",           action: "write"      },
  // Alerts
  { code: "alert.read",            resource: "alert",            action: "read"       },
  { code: "alert.acknowledge",     resource: "alert",            action: "acknowledge"},
];

// ─── Mapping rol → permisos ───────────────────────────────────────────────────

/**
 * Por conservadurismo: se asignan solo lo mínimo necesario por rol.
 * @type {Record<string, string[]>}
 */
const ROLE_PERMISSIONS = {
  MC: [
    "patient.read", "patient.write",
    "encounter.read", "encounter.write", "encounter.close",
    "rx.read", "rx.write", "rx.sign",
    "lab.read", "lab.order",
    "imaging.read", "imaging.order",
    "triage.read",
    "inpatient.read", "inpatient.admit", "inpatient.discharge",
    "surgery.read", "surgery.write",
    "consent.read", "consent.write", "consent.sign",
    "death.read", "death.write", "death.certify",
    "vitals.read", "vitals.write",
    "alert.read", "alert.acknowledge",
    "report.read",
    "workflow.read",
  ],
  ENF: [
    "patient.read",
    "encounter.read", "encounter.write",
    "rx.read", "rx.dispense",
    "lab.read",
    "imaging.read",
    "triage.read", "triage.write",
    "inpatient.read",
    "consent.read",
    "death.read",
    "vitals.read", "vitals.write",
    "alert.read", "alert.acknowledge",
    "report.read",
    "workflow.read",
  ],
  FARM: [
    "patient.read",
    "rx.read", "rx.dispense",
    "inventory.read", "inventory.write",
    "alert.read", "alert.acknowledge",
    "report.read",
  ],
  DIR: [
    "patient.read", "patient.write",
    "encounter.read", "encounter.close",
    "rx.read", "rx.sign",
    "lab.read",
    "imaging.read",
    "triage.read",
    "inpatient.read", "inpatient.discharge",
    "surgery.read",
    "consent.read", "consent.sign",
    "death.read", "death.certify",
    "vitals.read",
    "alert.read",
    "report.read", "report.export",
    "admin.audit",
    "workflow.read", "workflow.publish",
  ],
  ADMIN: [
    "patient.read", "patient.write", "patient.delete",
    "encounter.read", "encounter.write", "encounter.close",
    "rx.read", "rx.write", "rx.sign", "rx.dispense",
    "lab.read", "lab.order", "lab.result",
    "imaging.read", "imaging.order", "imaging.report",
    "triage.read", "triage.write",
    "inpatient.read", "inpatient.admit", "inpatient.discharge",
    "surgery.read", "surgery.write",
    "inventory.read", "inventory.write",
    "report.read", "report.export",
    "admin.users", "admin.roles", "admin.settings", "admin.audit",
    "workflow.read", "workflow.design", "workflow.publish",
    "consent.read", "consent.write", "consent.sign",
    "death.read", "death.write", "death.certify",
    "vitals.read", "vitals.write",
    "alert.read", "alert.acknowledge",
  ],
  ADMIN_CLINICO: [
    "patient.read", "patient.write",
    "encounter.read", "encounter.write", "encounter.close",
    "lab.read",
    "imaging.read",
    "triage.read",
    "inpatient.read", "inpatient.admit", "inpatient.discharge",
    "surgery.read",
    "consent.read", "consent.write",
    "death.read", "death.write",
    "vitals.read",
    "report.read", "report.export",
    "admin.users", "admin.audit",
    "workflow.read",
    "alert.read", "alert.acknowledge",
  ],
  WORKFLOW_DESIGNER: [
    "workflow.read", "workflow.design", "workflow.publish",
    "report.read",
    "alert.read",
  ],
  PHYSICIAN: [
    // alias de MC
    "patient.read", "patient.write",
    "encounter.read", "encounter.write", "encounter.close",
    "rx.read", "rx.write", "rx.sign",
    "lab.read", "lab.order",
    "imaging.read", "imaging.order",
    "inpatient.read", "inpatient.admit", "inpatient.discharge",
    "vitals.read", "vitals.write",
    "alert.read", "alert.acknowledge",
    "report.read",
    "workflow.read",
  ],
  NURSE: [
    // alias de ENF
    "patient.read",
    "encounter.read", "encounter.write",
    "rx.read",
    "lab.read",
    "triage.read", "triage.write",
    "inpatient.read",
    "vitals.read", "vitals.write",
    "alert.read", "alert.acknowledge",
    "report.read",
    "workflow.read",
  ],
  PHARM: [
    // alias de FARM
    "rx.read", "rx.dispense",
    "inventory.read", "inventory.write",
    "alert.read",
    "report.read",
  ],
};

// ─── Plantillas workflow (6 base F2-S16) ────────────────────────────────────

/**
 * Verificación de existencia de las 6 plantillas semilla.
 * La inserción real la hace seed-workflow-templates.mjs.
 * Aquí solo se asegura que existan; si no, las inserta con datos mínimos.
 */
const WORKFLOW_PLANTILLAS_BASE = [
  { codigo: "wf-hc-ambulatoria-primera",     nombre: "HC Ambulatoria — Primera vez",          categoria: "Ambulatorio" },
  { codigo: "wf-hc-ambulatoria-subsecuente", nombre: "HC Ambulatoria — Subsecuente",           categoria: "Ambulatorio" },
  { codigo: "wf-hospitalario-basico",        nombre: "Episodio Hospitalario Básico",           categoria: "Hospitalario" },
  { codigo: "wf-cirugia-electiva",           nombre: "Ruta Quirúrgica Electiva",               categoria: "Quirúrgico"  },
  { codigo: "wf-triage-manchester",          nombre: "Triage Manchester Emergencias",          categoria: "Emergencia"  },
  { codigo: "wf-consentimiento-ntec",        nombre: "Consentimiento Informado NTEC",          categoria: "Hospitalario" },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL o DIRECT_URL requerida.");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await seedRoles(client);
    await seedPermissions(client);
    await seedRolePermissions(client);
    await seedOrganization(client);
    const orgId = await getOrgId(client);
    await seedEstablishment(client, orgId);
    await updateGs1Prefix(client, orgId);
    await verifyWorkflowPlantillas(client);

    console.log("\nSeed go-live-defaults completado exitosamente.");
  } finally {
    await client.end();
  }
}

// ─── Funciones individuales ──────────────────────────────────────────────────

async function seedRoles(client) {
  console.log("\n[1/7] Roles base...");
  let inserted = 0;
  let skipped = 0;

  for (const role of ROLES) {
    const res = await client.query(
      `INSERT INTO public."Role" ("organizationId", "code", "name", "description", "active")
       VALUES (NULL, $1, $2, $3, true)
       ON CONFLICT ("organizationId", "code") DO NOTHING`,
      [role.code, role.name, role.description]
    );
    const n = res.rowCount ?? 0;
    inserted += n;
    skipped  += 1 - n;
  }

  console.log(`  Roles: ${inserted} insertados, ${skipped} ya existían`);
}

async function seedPermissions(client) {
  console.log("\n[2/7] Permisos base...");
  let inserted = 0;
  let skipped = 0;

  for (const perm of PERMISSIONS) {
    const res = await client.query(
      `INSERT INTO public."Permission" ("code", "resource", "action")
       VALUES ($1, $2, $3)
       ON CONFLICT ("code") DO NOTHING`,
      [perm.code, perm.resource, perm.action]
    );
    const n = res.rowCount ?? 0;
    inserted += n;
    skipped  += 1 - n;
  }

  console.log(`  Permisos: ${inserted} insertados, ${skipped} ya existían`);
}

async function seedRolePermissions(client) {
  console.log("\n[3/7] RolePermissions...");
  let inserted = 0;
  let skipped = 0;

  for (const [roleCode, permCodes] of Object.entries(ROLE_PERMISSIONS)) {
    // Recuperar ID del rol global (organizationId IS NULL)
    const roleRes = await client.query(
      `SELECT "id" FROM public."Role" WHERE "code" = $1 AND "organizationId" IS NULL LIMIT 1`,
      [roleCode]
    );
    if (roleRes.rows.length === 0) {
      console.warn(`  Advertencia: rol ${roleCode} no encontrado, saltando permisos`);
      continue;
    }
    const roleId = roleRes.rows[0].id;

    for (const permCode of permCodes) {
      const permRes = await client.query(
        `SELECT "id" FROM public."Permission" WHERE "code" = $1 LIMIT 1`,
        [permCode]
      );
      if (permRes.rows.length === 0) {
        console.warn(`  Advertencia: permiso ${permCode} no encontrado`);
        continue;
      }
      const permId = permRes.rows[0].id;

      const res = await client.query(
        `INSERT INTO public."RolePermission" ("roleId", "permissionId", "effect")
         VALUES ($1, $2, 'ALLOW')
         ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
        [roleId, permId]
      );
      const n = res.rowCount ?? 0;
      inserted += n;
      skipped  += 1 - n;
    }
  }

  console.log(`  RolePermissions: ${inserted} insertadas, ${skipped} ya existían`);
}

async function seedOrganization(client) {
  console.log("\n[4/7] Organización Avante...");

  // Obtener countryId para SLV y currency UUID para USD
  const countryRes = await client.query(
    `SELECT "id" FROM public."Country" WHERE "isoAlpha3" = 'SLV' LIMIT 1`
  );
  if (countryRes.rows.length === 0) {
    console.warn("  Advertencia: Country SLV no encontrada — omitiendo org. Ejecutar db:seed primero.");
    return;
  }
  const countryId = countryRes.rows[0].id;

  // Obtener currency USD
  const currRes = await client.query(
    `SELECT "id" FROM public."Currency" WHERE "isoCode" = 'USD' LIMIT 1`
  );
  if (currRes.rows.length === 0) {
    console.warn("  Advertencia: Currency USD no encontrada — omitiendo org. Ejecutar db:seed primero.");
    return;
  }
  const currencyId = currRes.rows[0].id;

  const res = await client.query(
    `INSERT INTO public."Organization"
       ("countryId", "legalName", "tradeName", "taxId", "functionalCurrency",
        "active", "gs1CompanyPrefix")
     VALUES ($1, $2, $3, $4, $5, true, $6)
     ON CONFLICT ("countryId", "taxId") DO NOTHING`,
    [
      countryId,
      "AVANTE Complejo Hospitalario S.A. de C.V.",
      "AVANTE Complejo Hospitalario",
      "0614-XXXXXX-XXX-X",
      currencyId,
      "7800001",
    ]
  );

  const n = res.rowCount ?? 0;
  console.log(`  Organización Avante: ${n > 0 ? "insertada" : "ya existía"}`);
}

async function getOrgId(client) {
  const res = await client.query(
    `SELECT "id" FROM public."Organization"
     WHERE "taxId" = '0614-XXXXXX-XXX-X'
     LIMIT 1`
  );
  return res.rows[0]?.id ?? null;
}

async function seedEstablishment(client, orgId) {
  console.log("\n[5/7] Establecimiento principal Avante...");

  if (!orgId) {
    console.warn("  Advertencia: Org Avante no encontrada — omitiendo establecimiento.");
    return;
  }

  const res = await client.query(
    `INSERT INTO public."Establishment"
       ("organizationId", "code", "name", "addressLine", "active")
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT DO NOTHING`,
    [
      orgId,
      "AVANTE-PRINCIPAL-01",
      "AVANTE Complejo Hospitalario — Sede Principal",
      "San Salvador, El Salvador",
    ]
  );

  const n = res.rowCount ?? 0;
  console.log(`  Establecimiento: ${n > 0 ? "insertado" : "ya existía"}`);
}

async function updateGs1Prefix(client, orgId) {
  console.log("\n[6/7] gs1CompanyPrefix en Org Avante...");

  if (!orgId) {
    console.warn("  Advertencia: Org Avante no encontrada — omitiendo gs1CompanyPrefix.");
    return;
  }

  // Solo actualiza si está null
  const res = await client.query(
    `UPDATE public."Organization"
     SET "gs1CompanyPrefix" = '7800001'
     WHERE "id" = $1 AND "gs1CompanyPrefix" IS NULL`,
    [orgId]
  );
  const n = res.rowCount ?? 0;
  console.log(`  gs1CompanyPrefix: ${n > 0 ? "actualizado a '7800001'" : "ya tenía valor (no modificado)"}`);
}

async function verifyWorkflowPlantillas(client) {
  console.log("\n[7/7] Verificando plantillas workflow ECE...");

  // Verificar que la tabla existe antes de consultar
  const tableCheck = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'ece' AND table_name = 'workflow_plantilla'
    ) AS exists
  `);

  if (!tableCheck.rows[0]?.exists) {
    console.warn("  Advertencia: tabla ece.workflow_plantilla no existe. Aplicar migración SQL primero.");
    return;
  }

  let present = 0;
  let missing = 0;
  const missingCodes = [];

  for (const p of WORKFLOW_PLANTILLAS_BASE) {
    const res = await client.query(
      `SELECT codigo FROM ece.workflow_plantilla WHERE codigo = $1 LIMIT 1`,
      [p.codigo]
    );
    if (res.rows.length > 0) {
      present++;
    } else {
      missing++;
      missingCodes.push(p.codigo);
      // Insertar plantilla mínima (sin estados/transiciones — el seed completo lo carga)
      await client.query(
        `INSERT INTO ece.workflow_plantilla
           (codigo, nombre, categoria, descripcion, estados_seed, transiciones_seed, es_sistema, activo)
         VALUES ($1, $2, $3, $4, '[]'::jsonb, '[]'::jsonb, true, true)
         ON CONFLICT (codigo) DO NOTHING`,
        [p.codigo, p.nombre, p.categoria, `Plantilla ${p.nombre} — seed mínimo go-live`]
      );
      console.log(`    Insertada plantilla mínima: ${p.codigo}`);
    }
  }

  console.log(`  Plantillas: ${present} presentes, ${missing} insertadas como mínimas`);
  if (missing > 0) {
    console.log("  RECOMENDADO: ejecutar seed-workflow-templates.mjs para cargar estados y transiciones completas.");
  }
}

main().catch((err) => {
  console.error("\nError fatal:", err.message);
  process.exit(1);
});
