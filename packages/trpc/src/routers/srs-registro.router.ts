/**
 * Router tRPC: Registro Sanitario SRS El Salvador.
 *
 * Wrappea el cliente @his/infrastructure/srs con cache local (SrsRegistroCache)
 * y permite importar un registro al catálogo Drug local.
 *
 * Spec: docs/35_integracion_srs_registro_sanitario.md
 *
 * Flujo típico:
 *   1. UI llama `buscar` con texto → router consulta SRS live → devuelve listado.
 *   2. UI ofrece "ver detalle" → router `detalle` consulta SRS + persiste en cache.
 *   3. UI ofrece "importar a Drug" → router `importarADrug` mapea cache → Drug.
 *
 * RBAC:
 *   - `buscar` / `detalle` → cualquier usuario tenant (lectura).
 *   - `importarADrug` → ADMIN o PHARMACIST.
 *
 * Drift: SrsRegistroCache + hijas + columnas srs* de Drug NO están en
 * schema.prisma. Toda operación vía $queryRawUnsafe.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  buscarPadron,
  obtenerDetalle,
  parseVidaUtilMeses,
  type SrsDetalle,
  type SrsFiltroBusqueda,
  type SrsEstado,
} from "@his/infrastructure";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

const readerProc = tenantProcedure;
const writerProc = requireRole(["ADMIN", "PHARMACIST"]);

const filtroEnum = z.enum(["nombre_comercial", "id_producto", "principio_activo"]);
const estadoEnum = z.enum(["ACTIVO", "CANCELADO", "SUSPENDIDO", "ELIMINADO", ""]);

const buscarInput = z.object({
  filtro: filtroEnum.default("nombre_comercial"),
  busqueda: z.string().trim().min(2).max(120),
  estado: estadoEnum.default("ACTIVO"),
  start: z.number().int().min(0).default(0),
  length: z.number().int().min(1).max(100).default(25),
});

const detalleInput = z.object({
  registroSanitario: z.string().trim().min(3).max(20),
  forceRefresh: z.boolean().default(false),
});

const importarInput = z.object({
  registroSanitario: z.string().trim().min(3).max(20),
  brandNameOverride: z.string().trim().max(200).optional(),
  alertLevel: z.enum(["standard", "high", "very_high", "critical"]).default("standard"),
});

interface CacheRow {
  registroSanitario: string;
  idProductoSrs: string;
  nombreRegistro: string;
  titular: string | null;
  estado: string;
  categoria: string | null;
  clasificacion: string | null;
  modalidadVenta: string | null;
  vidaUtilTexto: string | null;
  vidaUtilMeses: number | null;
  viaAdministracion: string | null;
  primeraAutorizacion: Date | null;
  anualidad: Date | null;
  condicionesAlmacenamiento: string | null;
  indicacionesTerapeuticas: string | null;
  mecanismoAccion: string | null;
  regimenDosificacion: string | null;
  farmacocinetica: string | null;
  efectosAdversos: string | null;
  contraindicaciones: string | null;
  precauciones: string | null;
  principalesInteracciones: string | null;
  fichaTecnicaUrl: string | null;
  expedienteUrl: string | null;
  informeEvaluacionUrl: string | null;
  fetchedAt: Date;
  expiresAt: Date;
}

interface PaRow {
  nombrePrincipioActivo: string;
  concentracion: string | null;
  unidadMedida: string | null;
}
interface FabricanteRow {
  idFabricanteSrs: string | null;
  nombreFabricante: string;
  paisFabricante: string | null;
  tipo: string;
  renovacion: Date | null;
}
interface PresentacionRow {
  codigoPresentacion: string | null;
  nombrePresentacion: string;
}

/** Persiste un SrsDetalle en cache local. UPSERT. */
async function persistirCache(
  tx: { $executeRawUnsafe: (q: string, ...p: unknown[]) => Promise<number> },
  detalle: SrsDetalle,
): Promise<void> {
  const vidaUtilMeses = parseVidaUtilMeses(detalle.vidaUtil);

  // UPSERT cabecera
  await tx.$executeRawUnsafe(
    `INSERT INTO "SrsRegistroCache" (
       "registroSanitario","idProductoSrs","nombreRegistro","titular","estado",
       "categoria","clasificacion","modalidadVenta","vidaUtilTexto","vidaUtilMeses",
       "viaAdministracion","primeraAutorizacion","anualidad",
       "condicionesAlmacenamiento","indicacionesTerapeuticas","mecanismoAccion",
       "regimenDosificacion","farmacocinetica","efectosAdversos",
       "contraindicaciones","precauciones","principalesInteracciones",
       "fichaTecnicaUrl","expedienteUrl","informeEvaluacionUrl",
       "rawPayload","fetchedAt","expiresAt"
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,now(),now() + interval '90 days'
     )
     ON CONFLICT ("registroSanitario") DO UPDATE SET
       "idProductoSrs" = EXCLUDED."idProductoSrs",
       "nombreRegistro" = EXCLUDED."nombreRegistro",
       "titular" = EXCLUDED."titular",
       "estado" = EXCLUDED."estado",
       "categoria" = EXCLUDED."categoria",
       "clasificacion" = EXCLUDED."clasificacion",
       "modalidadVenta" = EXCLUDED."modalidadVenta",
       "vidaUtilTexto" = EXCLUDED."vidaUtilTexto",
       "vidaUtilMeses" = EXCLUDED."vidaUtilMeses",
       "viaAdministracion" = EXCLUDED."viaAdministracion",
       "primeraAutorizacion" = EXCLUDED."primeraAutorizacion",
       "anualidad" = EXCLUDED."anualidad",
       "condicionesAlmacenamiento" = EXCLUDED."condicionesAlmacenamiento",
       "indicacionesTerapeuticas" = EXCLUDED."indicacionesTerapeuticas",
       "mecanismoAccion" = EXCLUDED."mecanismoAccion",
       "regimenDosificacion" = EXCLUDED."regimenDosificacion",
       "farmacocinetica" = EXCLUDED."farmacocinetica",
       "efectosAdversos" = EXCLUDED."efectosAdversos",
       "contraindicaciones" = EXCLUDED."contraindicaciones",
       "precauciones" = EXCLUDED."precauciones",
       "principalesInteracciones" = EXCLUDED."principalesInteracciones",
       "fichaTecnicaUrl" = EXCLUDED."fichaTecnicaUrl",
       "expedienteUrl" = EXCLUDED."expedienteUrl",
       "informeEvaluacionUrl" = EXCLUDED."informeEvaluacionUrl",
       "rawPayload" = EXCLUDED."rawPayload",
       "fetchedAt" = now(),
       "expiresAt" = now() + interval '90 days'`,
    detalle.registroSanitario,
    detalle.idProducto || detalle.registroSanitario,
    detalle.nombreRegistro,
    detalle.titular,
    detalle.estado,
    detalle.categoria,
    detalle.clasificacion,
    detalle.modalidadVenta,
    detalle.vidaUtil,
    vidaUtilMeses,
    detalle.viaAdministracion,
    detalle.primeraAutorizacion,
    detalle.anualidad,
    detalle.condicionesAlmacenamiento,
    detalle.indicacionesTerapeuticas,
    detalle.mecanismoAccion,
    detalle.regimenDosificacion,
    detalle.farmacocinetica,
    detalle.efectosAdversos,
    detalle.contraindicaciones,
    detalle.precauciones,
    detalle.principalesInteracciones,
    detalle.fichaTecnicaUrl,
    detalle.expedienteUrl,
    detalle.informeEvaluacionUrl,
    JSON.stringify(detalle.rawPayload),
  );

  // Reemplazar hijas (estrategia simple: DELETE + INSERT en lugar de diff)
  await tx.$executeRawUnsafe(
    `DELETE FROM "SrsPrincipioActivo" WHERE "registroSanitario" = $1`,
    detalle.registroSanitario,
  );
  for (const pa of detalle.principiosActivos) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "SrsPrincipioActivo" ("registroSanitario","nombrePrincipioActivo","concentracion","unidadMedida")
       VALUES ($1,$2,$3,$4)
       ON CONFLICT ("registroSanitario","nombrePrincipioActivo") DO NOTHING`,
      detalle.registroSanitario,
      pa.nombrePrincipioActivo,
      pa.concentracion,
      pa.unidadMedida,
    );
  }

  await tx.$executeRawUnsafe(
    `DELETE FROM "SrsFabricante" WHERE "registroSanitario" = $1`,
    detalle.registroSanitario,
  );
  for (const f of detalle.fabricantes) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "SrsFabricante" ("registroSanitario","idFabricanteSrs","nombreFabricante","paisFabricante","tipo","renovacion")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      detalle.registroSanitario,
      f.idFabricanteSrs,
      f.nombreFabricante,
      f.paisFabricante,
      f.tipo,
      f.renovacion,
    );
  }

  await tx.$executeRawUnsafe(
    `DELETE FROM "SrsFormaFarmaceutica" WHERE "registroSanitario" = $1`,
    detalle.registroSanitario,
  );
  for (const ff of detalle.formasFarmaceuticas) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "SrsFormaFarmaceutica" ("registroSanitario","nombreFormaFarmaceutica")
       VALUES ($1,$2)
       ON CONFLICT ("registroSanitario","nombreFormaFarmaceutica") DO NOTHING`,
      detalle.registroSanitario,
      ff,
    );
  }

  await tx.$executeRawUnsafe(
    `DELETE FROM "SrsPresentacion" WHERE "registroSanitario" = $1`,
    detalle.registroSanitario,
  );
  for (const p of detalle.presentaciones) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "SrsPresentacion" ("registroSanitario","codigoPresentacion","nombrePresentacion")
       VALUES ($1,$2,$3)`,
      detalle.registroSanitario,
      p.codigoPresentacion,
      p.nombrePresentacion,
    );
  }
}

/** Mapeo de forma farmacéutica SRS → enum HIS PharmaceuticalForm. */
function mapPharmaceuticalForm(srsForm: string | undefined): string {
  if (!srsForm) return "OTHER";
  const f = srsForm.toUpperCase();
  if (/TABLET|COMPRIMID|GRAGEA/.test(f)) return "TABLET";
  if (/CAPSUL|C[ÁA]PSUL/.test(f)) return "CAPSULE";
  if (/JARABE|SUSPENSI[ÓO]N ORAL|SOLUCI[ÓO]N ORAL|EMULSI[ÓO]N ORAL/.test(f)) return "SYRUP";
  if (/INYECTABLE|INFUSI[ÓO]N|LIOFILIZADO/.test(f)) return "INJECTION";
  if (/CREMA/.test(f)) return "CREAM";
  if (/POMADA|UNG[ÜU]ENTO/.test(f)) return "OINTMENT";
  if (/GOTAS/.test(f)) return "DROPS";
  if (/INHALADOR|AEROSOL|POLVO PARA INHAL/.test(f)) return "INHALER";
  if (/SUPOSITORIO|[ÓO]VULO/.test(f)) return "SUPPOSITORY";
  if (/PARCHE/.test(f)) return "PATCH";
  return "OTHER";
}

function mapDispensingClass(modalidad: string | null): string {
  if (!modalidad) return "RX";
  return modalidad.toUpperCase().includes("SIN RECETA") ? "OTC" : "RX";
}

export const srsRegistroRouter = router({
  /**
   * Busca en SRS en vivo. NO cachea el listado (solo el detalle se cachea).
   * Aprovecha cache para enriquecer items ya vistos con flag `cached`.
   */
  buscar: readerProc.input(buscarInput).query(async ({ ctx, input }) => {
    const { prisma, tenant } = ctx;
    const result = await buscarPadron({
      filtro: input.filtro as SrsFiltroBusqueda,
      busqueda: input.busqueda,
      estado: input.estado as SrsEstado | "",
      start: input.start,
      length: input.length,
    });

    // Marcar cuáles ya están en cache o importados como Drug
    const regs = result.data.map((d) => d.registroSanitario);
    if (regs.length === 0) return { ...result, cached: [], imported: [] };

    return withTenantContext(prisma, tenant, async (tx) => {
      const placeholders = regs.map((_, i) => `$${i + 1}`).join(",");
      const cached = await tx.$queryRawUnsafe<Array<{ registroSanitario: string }>>(
        `SELECT "registroSanitario" FROM "SrsRegistroCache" WHERE "registroSanitario" IN (${placeholders})`,
        ...regs,
      );
      const imported = await tx.$queryRawUnsafe<Array<{ registroSanitario: string }>>(
        `SELECT DISTINCT "srsRegistroSanitario" AS "registroSanitario" FROM "Drug"
         WHERE "organizationId" = $1 AND "srsRegistroSanitario" IN (${regs.map((_, i) => `$${i + 2}`).join(",")})`,
        tenant.organizationId,
        ...regs,
      );
      return {
        ...result,
        cached: cached.map((r) => r.registroSanitario),
        imported: imported.map((r) => r.registroSanitario),
      };
    });
  }),

  /**
   * Devuelve detalle. Si forceRefresh=false y hay cache no expirado, usa cache.
   * En cualquier caso persiste la versión más reciente.
   */
  detalle: readerProc.input(detalleInput).query(async ({ ctx, input }) => {
    const { prisma, tenant } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      if (!input.forceRefresh) {
        const cached = await tx.$queryRawUnsafe<CacheRow[]>(
          `SELECT * FROM "SrsRegistroCache"
           WHERE "registroSanitario" = $1 AND "expiresAt" > now()`,
          input.registroSanitario,
        );
        if (cached[0]) {
          const pa = await tx.$queryRawUnsafe<PaRow[]>(
            `SELECT "nombrePrincipioActivo","concentracion","unidadMedida"
             FROM "SrsPrincipioActivo" WHERE "registroSanitario" = $1
             ORDER BY "nombrePrincipioActivo"`,
            input.registroSanitario,
          );
          const fabricantes = await tx.$queryRawUnsafe<FabricanteRow[]>(
            `SELECT "idFabricanteSrs","nombreFabricante","paisFabricante","tipo","renovacion"
             FROM "SrsFabricante" WHERE "registroSanitario" = $1
             ORDER BY "tipo","nombreFabricante"`,
            input.registroSanitario,
          );
          const formas = await tx.$queryRawUnsafe<Array<{ nombreFormaFarmaceutica: string }>>(
            `SELECT "nombreFormaFarmaceutica" FROM "SrsFormaFarmaceutica"
             WHERE "registroSanitario" = $1
             ORDER BY "nombreFormaFarmaceutica"`,
            input.registroSanitario,
          );
          const presentaciones = await tx.$queryRawUnsafe<PresentacionRow[]>(
            `SELECT "codigoPresentacion","nombrePresentacion" FROM "SrsPresentacion"
             WHERE "registroSanitario" = $1
             ORDER BY "nombrePresentacion"`,
            input.registroSanitario,
          );
          return {
            source: "cache" as const,
            cabecera: cached[0],
            principiosActivos: pa,
            fabricantes,
            formasFarmaceuticas: formas.map((f) => f.nombreFormaFarmaceutica),
            presentaciones,
          };
        }
      }

      // Fetch live
      let detalle: SrsDetalle;
      try {
        detalle = await obtenerDetalle(input.registroSanitario);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `SRS no respondió: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      await persistirCache(tx, detalle);

      // Re-leer desde cache para tener el shape uniforme
      const cached = await tx.$queryRawUnsafe<CacheRow[]>(
        `SELECT * FROM "SrsRegistroCache" WHERE "registroSanitario" = $1`,
        input.registroSanitario,
      );

      return {
        source: "live" as const,
        cabecera: cached[0]!,
        principiosActivos: detalle.principiosActivos.map((p) => ({
          nombrePrincipioActivo: p.nombrePrincipioActivo,
          concentracion: p.concentracion,
          unidadMedida: p.unidadMedida,
        })),
        fabricantes: detalle.fabricantes.map((f) => ({
          idFabricanteSrs: f.idFabricanteSrs,
          nombreFabricante: f.nombreFabricante,
          paisFabricante: f.paisFabricante,
          tipo: f.tipo,
          renovacion: f.renovacion ? new Date(f.renovacion) : null,
        })),
        formasFarmaceuticas: detalle.formasFarmaceuticas,
        presentaciones: detalle.presentaciones,
      };
    });
  }),

  /**
   * Importa un registro al catálogo Drug local (tenant). Crea un registro Drug
   * con todos los campos srs* completados. Si ya existe (mismo org +
   * srsRegistroSanitario) → actualiza.
   */
  importarADrug: writerProc.input(importarInput).mutation(async ({ ctx, input }) => {
    const { prisma, tenant } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      // Asegurar cache fresca
      let detalle: SrsDetalle;
      try {
        detalle = await obtenerDetalle(input.registroSanitario);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `SRS no respondió: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      await persistirCache(tx, detalle);

      const principal = detalle.principiosActivos[0];
      if (!principal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Registro SRS sin principio activo declarado — no se puede mapear a Drug.",
        });
      }

      const genericName =
        detalle.principiosActivos.length === 1
          ? principal.nombrePrincipioActivo
          : detalle.principiosActivos.map((p) => p.nombrePrincipioActivo).join(" + ");

      const pharmForm = mapPharmaceuticalForm(detalle.formasFarmaceuticas[0]);
      const dispensing = mapDispensingClass(detalle.modalidadVenta);
      const vidaUtilMeses = parseVidaUtilMeses(detalle.vidaUtil);
      const strengthValue = principal.concentracion
        ? parseFloat(principal.concentracion.replace(",", ".")) || 0
        : 0;
      const strengthUnit = (principal.unidadMedida ?? "").toLowerCase() || "mg";

      // ¿ya existe?
      const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Drug"
         WHERE "organizationId" = $1 AND "srsRegistroSanitario" = $2 LIMIT 1`,
        tenant.organizationId,
        detalle.registroSanitario,
      );

      const brandName = input.brandNameOverride ?? detalle.nombreRegistro;

      if (existing[0]) {
        await tx.$executeRawUnsafe(
          `UPDATE "Drug" SET
             "brandName" = $1,
             "srsTitular" = $2,
             "srsPrimeraAutorizacion" = $3,
             "srsAnualidad" = $4,
             "srsCategoria" = $5,
             "srsClasificacion" = $6,
             "srsEstado" = $7,
             "srsCondicionesAlmacenamiento" = $8,
             "srsIndicacionesTerapeuticas" = $9,
             "srsContraindicaciones" = $10,
             "srsPrecauciones" = $11,
             "srsEfectosAdversos" = $12,
             "srsInteracciones" = $13,
             "srsVidaUtilMeses" = $14,
             "srsViaAdministracion" = $15,
             "srsFichaTecnicaUrl" = $16,
             "srsExpedienteUrl" = $17,
             "srsInformeEvaluacionUrl" = $18,
             "srsUltimaSincronizacion" = now(),
             "updatedAt" = now()
           WHERE id = $19`,
          brandName,
          detalle.titular,
          detalle.primeraAutorizacion,
          detalle.anualidad,
          detalle.categoria,
          detalle.clasificacion,
          detalle.estado,
          detalle.condicionesAlmacenamiento,
          detalle.indicacionesTerapeuticas,
          detalle.contraindicaciones,
          detalle.precauciones,
          detalle.efectosAdversos,
          detalle.principalesInteracciones,
          vidaUtilMeses,
          detalle.viaAdministracion,
          detalle.fichaTecnicaUrl,
          detalle.expedienteUrl,
          detalle.informeEvaluacionUrl,
          existing[0].id,
        );
        return { id: existing[0].id, mode: "updated" as const };
      }

      const result = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO "Drug" (
           "organizationId","genericName","brandName","pharmaceuticalForm",
           "strengthValue","strengthUnit","dispensingClass","active",
           "srsRegistroSanitario","srsIdProducto","srsTitular",
           "srsPrimeraAutorizacion","srsAnualidad","srsCategoria","srsClasificacion",
           "srsEstado","srsCondicionesAlmacenamiento","srsIndicacionesTerapeuticas",
           "srsContraindicaciones","srsPrecauciones","srsEfectosAdversos",
           "srsInteracciones","srsVidaUtilMeses","srsViaAdministracion",
           "srsFichaTecnicaUrl","srsExpedienteUrl","srsInformeEvaluacionUrl",
           "srsUltimaSincronizacion","alertLevel","updatedAt"
         ) VALUES (
           $1,$2,$3,$4::"PharmaceuticalForm",$5,$6,$7::"DispensingClass",
           $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,now(),$28,now()
         ) RETURNING id`,
        tenant.organizationId,
        genericName,
        brandName,
        pharmForm,
        strengthValue,
        strengthUnit,
        dispensing,
        detalle.estado === "ACTIVO",
        detalle.registroSanitario,
        detalle.idProducto || detalle.registroSanitario,
        detalle.titular,
        detalle.primeraAutorizacion,
        detalle.anualidad,
        detalle.categoria,
        detalle.clasificacion,
        detalle.estado,
        detalle.condicionesAlmacenamiento,
        detalle.indicacionesTerapeuticas,
        detalle.contraindicaciones,
        detalle.precauciones,
        detalle.efectosAdversos,
        detalle.principalesInteracciones,
        vidaUtilMeses,
        detalle.viaAdministracion,
        detalle.fichaTecnicaUrl,
        detalle.expedienteUrl,
        detalle.informeEvaluacionUrl,
        input.alertLevel,
      );

      const id = result[0]?.id;
      if (!id) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo crear Drug local.",
        });
      }
      return { id, mode: "created" as const };
    });
  }),

  /**
   * Re-valida estados/vigencias de todos los Drug con srsRegistroSanitario.
   * Pensado para correr vía cron (scripts/srs-revalidar-vigencias.mjs).
   * Lanza fetch a SRS por cada registro distinto. Persiste cambios.
   * Retorna resumen: total, ok, errores, cambiosDeEstado.
   */
  revalidarVigencias: writerProc.mutation(async ({ ctx }) => {
    const { prisma, tenant } = ctx;

    return withTenantContext(prisma, tenant, async (tx) => {
      const registros = await tx.$queryRawUnsafe<
        Array<{ srsRegistroSanitario: string; srsEstado: string | null }>
      >(
        `SELECT DISTINCT "srsRegistroSanitario","srsEstado" FROM "Drug"
         WHERE "organizationId" = $1 AND "srsRegistroSanitario" IS NOT NULL`,
        tenant.organizationId,
      );

      let ok = 0;
      let errores = 0;
      const cambiosDeEstado: Array<{ registro: string; antes: string | null; despues: string }> = [];

      for (const r of registros) {
        try {
          const detalle = await obtenerDetalle(r.srsRegistroSanitario);
          await persistirCache(tx, detalle);
          if (detalle.estado !== r.srsEstado) {
            cambiosDeEstado.push({
              registro: r.srsRegistroSanitario,
              antes: r.srsEstado,
              despues: detalle.estado,
            });
            await tx.$executeRawUnsafe(
              `UPDATE "Drug" SET
                 "srsEstado" = $1,
                 "srsAnualidad" = $2,
                 "active" = $3,
                 "srsUltimaSincronizacion" = now(),
                 "updatedAt" = now()
               WHERE "organizationId" = $4 AND "srsRegistroSanitario" = $5`,
              detalle.estado,
              detalle.anualidad,
              detalle.estado === "ACTIVO",
              tenant.organizationId,
              r.srsRegistroSanitario,
            );
          } else {
            await tx.$executeRawUnsafe(
              `UPDATE "Drug" SET
                 "srsAnualidad" = $1,
                 "srsUltimaSincronizacion" = now()
               WHERE "organizationId" = $2 AND "srsRegistroSanitario" = $3`,
              detalle.anualidad,
              tenant.organizationId,
              r.srsRegistroSanitario,
            );
          }
          ok++;
        } catch {
          errores++;
        }
      }

      return { total: registros.length, ok, errores, cambiosDeEstado };
    });
  }),
});
