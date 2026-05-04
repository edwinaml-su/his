/**
 * US-4.5 + US-7.3 — Router de vacunación PAI.
 *
 * Endpoints:
 *  - listVaccines: catálogo de vacunas (filtra por país opcional / texto / activas).
 *  - byPatient: registro de vacunación de un paciente, agrupado por vaccineId con
 *    dose tracking (applied vs expected según `PAI_SCHEDULE_SV`).
 *  - recordVaccination: registra una dosis. Antes de persistir, hace matching simple
 *    contra `PatientAllergy.substanceText` y devuelve un warning si hay coincidencia.
 *    Si el cliente no envía `overrideAllergyAlert=true`, se rechaza con BAD_REQUEST.
 *
 * Edge cases manejados:
 *  - Vacuna sin esquema definido → expectedDoses=1 (default conservador, log con TODO).
 *  - Alergia matcher: case-insensitive, substring sobre `substanceText` y sobre los
 *    componentes conocidos (mapeo manual `VACCINE_COMPONENTS` por code).
 *  - Dosis duplicada (mismo paciente + vaccineId + doseNumber): retorna CONFLICT.
 *
 * NOTA INTEGRACIÓN: este router NO está aún registrado en `_app.ts` (no se toca por
 * acuerdo de paralelismo). El equipo de integración debe importarlo y montar bajo
 * la key `vaccination`.
 *
 * Patrón: imitando consent.router.ts (TRPCError homogéneo, tenant scoping).
 */
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import {
  vaccineListInput,
  vaccineCreateInput,
  recordVaccinationInput,
  vaccinationByPatientInput,
  expectedDosesFor,
} from "../../../contracts/src/schemas/vaccination";
import { router, tenantProcedure } from "../trpc";

/**
 * Componentes de las vacunas PAI más comunes para matching contra alergias.
 * Si una alergia tiene `substanceText` que matchea cualquiera de estos keywords,
 * se dispara la alerta para esa vacuna.
 *
 * TODO Sprint 2: tabla `VaccineComponent` (vaccineId → componentText[]) en BD.
 */
const VACCINE_COMPONENTS: Record<string, ReadonlyArray<string>> = {
  BCG: ["bcg", "tuberculina"],
  "HEPB-RN": ["hepatitis b", "hepb", "levadura", "thimerosal"],
  HEPB: ["hepatitis b", "hepb", "levadura", "thimerosal"],
  PENTAVALENTE: ["dpt", "tetanos", "difteria", "pertussis", "haemophilus", "hepatitis b"],
  "POLIO-IPV": ["polio", "neomicina", "estreptomicina", "polimixina"],
  ROTAVIRUS: ["rotavirus", "lactosa"],
  NEUMOCOCO: ["neumococo", "pcv13", "pcv10"],
  INFLUENZA: ["influenza", "huevo", "ovoalbumina", "neomicina"],
  SRP: ["sarampion", "rubeola", "parotiditis", "huevo", "neomicina", "gelatina"],
  DPT: ["dpt", "tetanos", "difteria", "pertussis"],
  TD: ["tetanos", "difteria"],
  VPH: ["vph", "hpv", "levadura"],
  FA: ["fiebre amarilla", "huevo", "gelatina"],
  COVID19: ["covid", "polietilenglicol", "peg"],
};

interface AllergyMatchHit {
  allergyId: string;
  substance: string;
  severity: string;
  matchedKeyword: string;
}

/** Detecta si alguna alergia activa matchea componentes de la vacuna. */
function findAllergyMatches(
  allergies: ReadonlyArray<{ id: string; substanceText: string; severity: string }>,
  vaccineCode: string,
  vaccineName: string,
): AllergyMatchHit[] {
  const components = [
    ...(VACCINE_COMPONENTS[vaccineCode] ?? []),
    vaccineCode.toLowerCase(),
    vaccineName.toLowerCase(),
  ];
  const hits: AllergyMatchHit[] = [];
  for (const a of allergies) {
    const sub = a.substanceText.toLowerCase().trim();
    if (!sub) continue;
    const hit = components.find((c) => sub.includes(c) || c.includes(sub));
    if (hit) {
      hits.push({
        allergyId: a.id,
        substance: a.substanceText,
        severity: a.severity,
        matchedKeyword: hit,
      });
    }
  }
  return hits;
}

export const vaccinationRouter = router({
  /**
   * Catálogo de vacunas. Por defecto retorna las del país del tenant + las globales
   * (countryId IS NULL).
   */
  listVaccines: tenantProcedure
    .input(vaccineListInput)
    .query(async ({ ctx, input }) => {
      const countryFilter = input.countryId
        ? { countryId: input.countryId }
        : input.countryIso
          ? {
              country: { isoAlpha3: input.countryIso.toUpperCase() },
            }
          : {
              OR: [{ countryId: ctx.tenant.countryId }, { countryId: null }],
            };

      return ctx.prisma.vaccine.findMany({
        where: {
          ...countryFilter,
          ...(input.activeOnly ? { active: true } : {}),
          ...(input.search
            ? {
                OR: [
                  { code: { contains: input.search, mode: "insensitive" } },
                  { name: { contains: input.search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: [{ code: "asc" }],
      });
    }),

  /**
   * Crea una vacuna en el catálogo (admin). Idempotente vía unique (countryId, code).
   */
  createVaccine: tenantProcedure
    .input(vaccineCreateInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.prisma.vaccine.create({
          data: {
            countryId: input.countryId ?? null,
            code: input.code,
            name: input.name,
            manufacturer: input.manufacturer,
            routeOfAdmin: input.routeOfAdmin,
            scheduleNote: input.scheduleNote,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya existe una vacuna con código ${input.code} para ese país.`,
          });
        }
        throw err;
      }
    }),

  /**
   * Vacunación del paciente agrupada por vaccineId con dose tracking.
   * - Filtra el paciente por organización del tenant.
   * - Devuelve para cada vacuna: applied (con detalle de dosis) + expected.
   */
  byPatient: tenantProcedure
    .input(vaccinationByPatientInput)
    .query(async ({ ctx, input }) => {
      const patient = await ctx.prisma.patient.findUnique({
        where: { id: input.patientId },
        select: { id: true, organizationId: true },
      });
      if (!patient || patient.organizationId !== ctx.tenant.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
      }

      const records = await ctx.prisma.patientVaccination.findMany({
        where: { patientId: input.patientId },
        include: {
          vaccine: true,
        },
        orderBy: [{ administeredAt: "asc" }],
      });

      // Agrupa por vaccineId.
      const groups = new Map<
        string,
        {
          vaccine: (typeof records)[number]["vaccine"];
          doses: Array<(typeof records)[number]>;
        }
      >();
      for (const r of records) {
        const g = groups.get(r.vaccineId);
        if (g) g.doses.push(r);
        else groups.set(r.vaccineId, { vaccine: r.vaccine, doses: [r] });
      }

      return Array.from(groups.values()).map(({ vaccine, doses }) => {
        const expected = expectedDosesFor(vaccine.code);
        const applied = doses.length;
        return {
          vaccineId: vaccine.id,
          code: vaccine.code,
          name: vaccine.name,
          routeOfAdmin: vaccine.routeOfAdmin,
          scheduleNote: vaccine.scheduleNote,
          applied,
          expected,
          complete: applied >= expected,
          doses: doses.map((d) => ({
            id: d.id,
            doseNumber: d.doseNumber,
            administeredAt: d.administeredAt,
            lotNumber: d.lotNumber,
            anatomicalSite: d.anatomicalSite,
            expirationDate: d.expirationDate,
            reactionsObserved: d.reactionsObserved,
            notes: d.notes,
          })),
        };
      });
    }),

  /**
   * Registra una dosis aplicada al paciente.
   * - Verifica paciente del tenant.
   * - Hace matching de alergias y, si hay hits y `overrideAllergyAlert=false`,
   *   rechaza con BAD_REQUEST incluyendo los hits para que la UI confirme.
   * - Detecta dosis duplicada (CONFLICT) por (patientId, vaccineId, doseNumber).
   */
  recordVaccination: tenantProcedure
    .input(recordVaccinationInput)
    .mutation(async ({ ctx, input }) => {
      const [patient, vaccine] = await Promise.all([
        ctx.prisma.patient.findUnique({
          where: { id: input.patientId },
          select: {
            id: true,
            organizationId: true,
            allergies: {
              where: { active: true },
              select: { id: true, substanceText: true, severity: true },
            },
          },
        }),
        ctx.prisma.vaccine.findUnique({ where: { id: input.vaccineId } }),
      ]);

      if (!patient || patient.organizationId !== ctx.tenant.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
      }
      if (!vaccine || !vaccine.active) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Vacuna no encontrada o inactiva.",
        });
      }

      // Alerta de alergia (matching simple por keyword).
      const allergyHits = findAllergyMatches(patient.allergies, vaccine.code, vaccine.name);
      if (allergyHits.length > 0 && !input.overrideAllergyAlert) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `El paciente tiene ${allergyHits.length} alergia(s) con coincidencia sobre componentes de ${vaccine.name}. ` +
            `Substancias: ${allergyHits.map((h) => h.substance).join(", ")}. ` +
            `Confirme override clínico para continuar.`,
          cause: { allergyHits },
        });
      }

      // Dosis duplicada (regla de negocio MVP: una entrada por (patient, vaccine, doseNumber)).
      const existing = await ctx.prisma.patientVaccination.findFirst({
        where: {
          patientId: input.patientId,
          vaccineId: input.vaccineId,
          doseNumber: input.doseNumber,
        },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La dosis ${input.doseNumber} de ${vaccine.name} ya fue registrada.`,
        });
      }

      try {
        const created = await ctx.prisma.patientVaccination.create({
          data: {
            patientId: input.patientId,
            vaccineId: input.vaccineId,
            organizationId: ctx.tenant.organizationId,
            establishmentId: ctx.tenant.establishmentId ?? undefined,
            doseNumber: input.doseNumber,
            administeredAt: input.administeredAt,
            lotNumber: input.lotNumber,
            expirationDate: input.expirationDate,
            anatomicalSite: input.anatomicalSite,
            administeredById: ctx.tenant.userId,
            reactionsObserved: input.reactionsObserved,
            notes: input.notes,
            createdBy: ctx.tenant.userId,
          },
        });
        return {
          ...created,
          allergyHits, // Si hubo hits y se hizo override, se devuelven para auditoría UI.
        };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Referencia inválida (paciente, vacuna u organización).",
          });
        }
        throw err;
      }
    }),
});
