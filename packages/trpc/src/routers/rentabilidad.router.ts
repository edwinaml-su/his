/**
 * Router tRPC — Tableros de rentabilidad por afiliado y ocupación de
 * consultorios (CC-0036 Ola 6, REQ-HIS-AFIL-001 S7, US.AFIL.1.8).
 * sql/249_cc0036_tableros.sql. ÚLTIMA ola del REQ-HIS-AFIL-001.
 *
 * `tablero.porAfiliado`/`tablero.detalleAfiliado` leen
 * `analytics.mv_rentabilidad_afiliado` a través de
 * `analytics.fn_rentabilidad_afiliado()` (SECURITY DEFINER, filtra por
 * `analytics.current_bi_org_id()` — el GUC que `withTenantContext` ya fija).
 * NFR-2 lo permite explícito: "el tablero hace el trabajo pesado en la
 * matview; el router solo filtra/pagina" — por eso no hay agregación
 * adicional cara acá, solo el merge de filas mes x establecimiento a
 * totales por afiliado.
 *
 * `ocupacion.porConsultorio` (AC3) NO usa matview (decisión documentada en
 * sql/249 §encabezado): reusa `fn_agenda_disponibilidad()` con el mismo
 * patrón de `outpatient.router.ts` `tablero.indicadores` (Ola 4) para
 * cupos usados/publicados, y calcula horas contratadas (ContratoJornada de
 * contratos VIGENTE) sobre horas disponibles (AgendaHorario — el "horario
 * base" en que el consultorio efectivamente opera) en JS, acotado por
 * semana (no prorateo día a día de altas/bajas de contrato a mitad de
 * período — simplificación documentada, AC3 no exige esa precisión).
 *
 * AC4 (afiliado inactivo comercialmente): calculado en query contra
 * `ProduccionMedica`/`ContratoArrendamiento` en vivo (tablas OLTP, NO la
 * matview) — no se persiste columna, tal como pide el criterio.
 */
import { rentabilidadTableroSchema, rentabilidadDetalleSchema, ocupacionConsultorioSchema } from "@his/contracts";
import { router, requirePermission } from "../trpc";
import { withTenantContext } from "../rls-context";

const tableroProc = requirePermission("tablero_afiliado.leer");

const DIAS_INACTIVIDAD = 90;

interface RentabilidadRow {
  organization_id: string;
  medico_afiliado_id: string;
  establishment_id: string;
  period_month: string;
  renta_devengada: string;
  renta_cobrada: string;
  produccion_total: string;
  produccion_por_linea: Record<string, string> | string | null;
  honorarios_devengados: string;
  margen_contribucion: string;
  calculado_en: string;
}

/**
 * `produccion_por_linea` normalmente ya llega deserializado por Prisma
 * (jsonb -> objeto), pero se tolera el caso "string sin parsear" de algunos
 * drivers/mocks de test.
 */
function normalizeLineas(raw: Record<string, string> | string | null): Record<string, string> {
  if (raw == null) return {};
  return typeof raw === "string" ? (JSON.parse(raw) as Record<string, string>) : raw;
}

/** Suma dos mapas {linea: monto} (montos vienen como string numeric de Postgres). */
function mergeLineas(base: Record<string, number>, incoming: Record<string, string> | string | null): Record<string, number> {
  for (const [linea, monto] of Object.entries(normalizeLineas(incoming))) {
    base[linea] = (base[linea] ?? 0) + Number(monto);
  }
  return base;
}

export const rentabilidadRouter = router({
  tablero: router({
    /** US.AFIL.1.8 AC1/AC2/AC4 — un renglón por afiliado con los totales del período. */
    porAfiliado: tableroProc.input(rentabilidadTableroSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const rows = await tx.$queryRaw<RentabilidadRow[]>`
          SELECT
            organization_id::text,
            medico_afiliado_id::text,
            establishment_id::text,
            period_month::text,
            renta_devengada::text,
            renta_cobrada::text,
            produccion_total::text,
            produccion_por_linea,
            honorarios_devengados::text,
            margen_contribucion::text,
            calculado_en::text
          FROM analytics.fn_rentabilidad_afiliado(
            ${input.desde}::date,
            ${input.hasta}::date,
            ${input.establishmentId ?? null}::uuid
          )
        `;

        // Merge de filas mes x establecimiento -> totales por afiliado.
        const porMedico = new Map<
          string,
          {
            rentaDevengada: number;
            rentaCobrada: number;
            produccionTotal: number;
            produccionPorLinea: Record<string, number>;
            honorariosDevengados: number;
            margenContribucion: number;
          }
        >();
        for (const r of rows) {
          const acc = porMedico.get(r.medico_afiliado_id) ?? {
            rentaDevengada: 0,
            rentaCobrada: 0,
            produccionTotal: 0,
            produccionPorLinea: {},
            honorariosDevengados: 0,
            margenContribucion: 0,
          };
          acc.rentaDevengada += Number(r.renta_devengada);
          acc.rentaCobrada += Number(r.renta_cobrada);
          acc.produccionTotal += Number(r.produccion_total);
          acc.honorariosDevengados += Number(r.honorarios_devengados);
          acc.margenContribucion += Number(r.margen_contribucion);
          mergeLineas(acc.produccionPorLinea, r.produccion_por_linea ?? {});
          porMedico.set(r.medico_afiliado_id, acc);
        }

        const medicoIds = [...porMedico.keys()];
        if (medicoIds.length === 0) return [];

        const [medicos, contratosVigentes, ultimasProducciones] = await Promise.all([
          tx.medicoAfiliado.findMany({
            where: { id: { in: medicoIds }, organizationId: tenant.organizationId },
            select: { id: true, nombreCompleto: true, jvpmNumero: true, estado: true },
          }),
          tx.contratoArrendamiento.findMany({
            where: { medicoAfiliadoId: { in: medicoIds }, organizationId: tenant.organizationId, estado: "VIGENTE" },
            select: { medicoAfiliadoId: true },
            distinct: ["medicoAfiliadoId"],
          }),
          // AC4 — última producción histórica (no acotada al período del filtro),
          // calculado en vivo, no persistido.
          tx.produccionMedica.groupBy({
            by: ["medicoAfiliadoId"],
            where: { medicoAfiliadoId: { in: medicoIds }, organizationId: tenant.organizationId, estado: { not: "REVERSADO" } },
            _max: { fecha: true },
          }),
        ]);

        const medicoMap = new Map(medicos.map((m) => [m.id, m]));
        const contratoVigenteSet = new Set(contratosVigentes.map((c) => c.medicoAfiliadoId));
        const ultimaProduccionMap = new Map(ultimasProducciones.map((u) => [u.medicoAfiliadoId, u._max.fecha]));
        const hoy = Date.now();

        return medicoIds.map((id) => {
          const acc = porMedico.get(id)!;
          const medico = medicoMap.get(id);
          const ultimaProduccion = ultimaProduccionMap.get(id) ?? null;
          const diasSinProduccion = ultimaProduccion ? (hoy - ultimaProduccion.getTime()) / 86_400_000 : null;
          const inactivoComercialmente =
            contratoVigenteSet.has(id) && (ultimaProduccion === null || (diasSinProduccion ?? Infinity) > DIAS_INACTIVIDAD);

          return {
            medicoAfiliadoId: id,
            nombreCompleto: medico?.nombreCompleto ?? "(afiliado no encontrado)",
            jvpmNumero: medico?.jvpmNumero ?? null,
            rentaDevengada: acc.rentaDevengada,
            rentaCobrada: acc.rentaCobrada,
            produccionTotal: acc.produccionTotal,
            produccionPorLinea: acc.produccionPorLinea,
            honorariosDevengados: acc.honorariosDevengados,
            margenContribucion: acc.margenContribucion,
            inactivoComercialmente,
          };
        });
      });
    }),

    /** US.AFIL.1.8 AC1 drilldown — desglose mensual de un afiliado. */
    detalleAfiliado: tableroProc.input(rentabilidadDetalleSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const rows = await tx.$queryRaw<RentabilidadRow[]>`
          SELECT
            period_month::text,
            establishment_id::text,
            renta_devengada::text,
            renta_cobrada::text,
            produccion_total::text,
            produccion_por_linea,
            honorarios_devengados::text,
            margen_contribucion::text
          FROM analytics.fn_rentabilidad_afiliado(
            ${input.desde}::date,
            ${input.hasta}::date,
            ${input.establishmentId ?? null}::uuid
          )
          WHERE medico_afiliado_id = ${input.medicoAfiliadoId}::uuid
          ORDER BY period_month ASC
        `;
        return rows.map((r) => ({
          periodMonth: r.period_month,
          establishmentId: r.establishment_id,
          rentaDevengada: Number(r.renta_devengada),
          rentaCobrada: Number(r.renta_cobrada),
          produccionTotal: Number(r.produccion_total),
          produccionPorLinea: normalizeLineas(r.produccion_por_linea),
          honorariosDevengados: Number(r.honorarios_devengados),
          margenContribucion: Number(r.margen_contribucion),
        }));
      });
    }),
  }),

  ocupacion: router({
    /** US.AFIL.1.8 AC3 — % horas contratadas/disponibles + % cupos usados/publicados, por consultorio. */
    porConsultorio: tableroProc.input(ocupacionConsultorioSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const consultorios = await tx.consultorio.findMany({
          where: {
            organizationId: tenant.organizationId,
            active: true,
            ...(input.establishmentId ? { establishmentId: input.establishmentId } : {}),
          },
          select: { id: true, codigo: true, nombre: true },
          take: 100,
        });
        if (consultorios.length === 0) return [];
        const consultorioIds = consultorios.map((c) => c.id);

        // Horas contratadas: ContratoJornada de contratos VIGENTE, horas/semana.
        const jornadas = await tx.contratoJornada.findMany({
          where: { contrato: { consultorioId: { in: consultorioIds }, estado: "VIGENTE" } },
          select: { horaInicio: true, horaFin: true, contrato: { select: { consultorioId: true } } },
        });
        const horasContratadasPorConsultorio = new Map<string, number>();
        for (const j of jornadas) {
          const horas = (j.horaFin.getTime() - j.horaInicio.getTime()) / 3_600_000;
          const consultorioId = j.contrato.consultorioId;
          horasContratadasPorConsultorio.set(consultorioId, (horasContratadasPorConsultorio.get(consultorioId) ?? 0) + horas);
        }

        // Horas disponibles: AgendaHorario ("horario base") de las agendas
        // publicadas en ese consultorio.
        const agendas = await tx.agendaMedico.findMany({
          where: { consultorioId: { in: consultorioIds }, organizationId: tenant.organizationId },
          select: { id: true, consultorioId: true },
          take: 200,
        });
        const agendaIdToConsultorio = new Map(agendas.map((a) => [a.id, a.consultorioId]));
        const horarios = agendas.length
          ? await tx.agendaHorario.findMany({
              where: { agendaId: { in: agendas.map((a) => a.id) } },
              select: { agendaId: true, horaInicio: true, horaFin: true },
            })
          : [];
        const horasDisponiblesPorConsultorio = new Map<string, number>();
        for (const h of horarios) {
          const consultorioId = agendaIdToConsultorio.get(h.agendaId);
          if (!consultorioId) continue;
          const horas = (h.horaFin.getTime() - h.horaInicio.getTime()) / 3_600_000;
          horasDisponiblesPorConsultorio.set(consultorioId, (horasDisponiblesPorConsultorio.get(consultorioId) ?? 0) + horas);
        }

        // Cupos usados/publicados — mismo patrón que outpatient.router.ts
        // tablero.indicadores (Ola 4): fn_agenda_disponibilidad por agenda,
        // acotado a las agendas ya resueltas arriba (guarda de performance).
        const cuposPorConsultorio = new Map<string, { capacidad: number; ocupados: number }>();
        for (const a of agendas) {
          const slots = await tx.$queryRaw<Array<{ capacidad: number; ocupados: number }>>`
            SELECT capacidad, ocupados FROM public.fn_agenda_disponibilidad(${a.id}::uuid, ${input.desde}::date, ${input.hasta}::date)
          `;
          const acc = cuposPorConsultorio.get(a.consultorioId) ?? { capacidad: 0, ocupados: 0 };
          for (const s of slots) {
            acc.capacidad += s.capacidad;
            acc.ocupados += s.ocupados;
          }
          cuposPorConsultorio.set(a.consultorioId, acc);
        }

        return consultorios.map((c) => {
          const horasContratadas = horasContratadasPorConsultorio.get(c.id) ?? 0;
          const horasDisponibles = horasDisponiblesPorConsultorio.get(c.id) ?? 0;
          const cupos = cuposPorConsultorio.get(c.id) ?? { capacidad: 0, ocupados: 0 };
          return {
            consultorioId: c.id,
            codigo: c.codigo,
            nombre: c.nombre,
            horasContratadasSemana: horasContratadas,
            horasDisponiblesSemana: horasDisponibles,
            pctHorasContratadas: horasDisponibles > 0 ? horasContratadas / horasDisponibles : null,
            cuposPublicados: cupos.capacidad,
            cuposUsados: cupos.ocupados,
            pctCuposUsados: cupos.capacidad > 0 ? cupos.ocupados / cupos.capacidad : null,
          };
        });
      });
    }),
  }),
});

export type RentabilidadRouter = typeof rentabilidadRouter;
