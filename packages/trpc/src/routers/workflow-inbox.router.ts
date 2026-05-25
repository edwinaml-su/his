/**
 * Router tRPC — Workflow Inbox (Bandeja BPM centralizada).
 *
 * Agrega tareas pendientes de múltiples dominios (Prescription, LabOrder,
 * ImagingOrder, TriageEvaluation, MedicationAdministration) en un shape
 * unificado y enruta cada tarea al usuario según su rol RBAC.
 *
 * Estrategia de performance:
 *   - Queries de listado son escalares (solo IDs + timestamps). Luego un
 *     batch fetch a Patient enriquece nombres/MRN una sola vez para todos.
 *   - Queries con roles que el usuario no tiene se skip-ean para evitar
 *     lecturas innecesarias.
 *   - Resultados se mergean en memoria y se ordenan por overdue/priority/age.
 *
 * Spec: ver packages/contracts/src/schemas/workflow-inbox.ts
 */
import {
  inboxFiltersSchema,
  type InboxResponse,
  type Task,
  type TaskPriority,
  type TaskType,
  TASK_REQUIRED_ROLES,
  TASK_SLA_MINUTES,
  TASK_TYPE_LABEL,
} from "@his/contracts/schemas/workflow-inbox";
import { router, tenantProcedure } from "../trpc";

function derivePriority(ageMinutes: number, slaMinutes: number | null): TaskPriority {
  if (slaMinutes === null) return "NORMAL";
  const pct = ageMinutes / slaMinutes;
  if (pct > 1) return "CRITICAL";
  if (pct > 0.7) return "HIGH";
  if (pct > 0.4) return "NORMAL";
  return "LOW";
}

function ageInMinutes(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 60_000) * 10) / 10;
}

function userHasAnyRole(userRoles: string[], required: string[]): boolean {
  return required.some((r) => userRoles.includes(r));
}

interface PatientMini {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
}

export const workflowInboxRouter = router({
  /**
   * Devuelve las tareas pendientes del usuario según sus roles.
   * Multi-source query con Promise.all + batch enrichment.
   */
  miBandeja: tenantProcedure
    .input(inboxFiltersSchema.optional())
    .query(async ({ ctx, input }): Promise<InboxResponse> => {
      const filters = input ?? inboxFiltersSchema.parse({});
      const { prisma, tenant, user } = ctx;
      const userRoles = tenant.roleCodes;
      const orgId = tenant.organizationId;
      const now = new Date();

      function isEnabled(type: TaskType): boolean {
        if (filters.types && filters.types.length > 0 && !filters.types.includes(type)) {
          return false;
        }
        return userHasAnyRole(userRoles, TASK_REQUIRED_ROLES[type]);
      }

      // ── Source 1: Prescription DRAFT del médico actual ────────────────────
      const rxToSign = isEnabled("PRESCRIPTION_TO_SIGN")
        ? await prisma.prescription.findMany({
            where: { organizationId: orgId, status: "DRAFT", prescriberId: user.id },
            select: { id: true, prescribedAt: true, notes: true, patientId: true },
            orderBy: { prescribedAt: "asc" },
            take: 100,
          })
        : [];

      // ── Source 2: Prescription SIGNED esperando dispensación ──────────────
      const rxToDispense = isEnabled("PRESCRIPTION_TO_DISPENSE")
        ? await prisma.prescription.findMany({
            where: { organizationId: orgId, status: "SIGNED" },
            select: { id: true, signedAt: true, prescribedAt: true, patientId: true },
            orderBy: { signedAt: "asc" },
            take: 100,
          })
        : [];

      // ── Source 3: Triage IN_PROGRESS ──────────────────────────────────────
      const triages = isEnabled("TRIAGE_IN_PROGRESS")
        ? await prisma.triageEvaluation.findMany({
            where: {
              organizationId: orgId,
              ...(tenant.establishmentId ? { establishmentId: tenant.establishmentId } : {}),
              status: "IN_PROGRESS",
            },
            select: {
              id: true,
              startedAt: true,
              patientId: true,
              assignedLevel: { select: { name: true, color: true } },
            },
            orderBy: { startedAt: "asc" },
            take: 100,
          })
        : [];

      // ── Source 4: LabOrder ORDERED/COLLECTED ──────────────────────────────
      const labs = isEnabled("LAB_TO_PROCESS")
        ? await prisma.labOrder.findMany({
            where: { organizationId: orgId, status: { in: ["ORDERED", "COLLECTED"] } },
            select: { id: true, orderedAt: true, patientId: true },
            orderBy: { orderedAt: "asc" },
            take: 100,
          })
        : [];

      // ── Source 5: ImagingOrder COMPLETED ──────────────────────────────────
      const images = isEnabled("IMAGING_TO_REPORT")
        ? await prisma.imagingOrder.findMany({
            where: { organizationId: orgId, status: "COMPLETED" },
            select: { id: true, orderedAt: true, patientId: true },
            orderBy: { orderedAt: "asc" },
            take: 100,
          })
        : [];

      // ── Source 6: MedicationAdministration SCHEDULED próximas 4h ──────────
      const meds = isEnabled("MED_TO_ADMINISTER")
        ? await prisma.medicationAdministration.findMany({
            where: {
              organizationId: orgId,
              status: "SCHEDULED",
              administeredAt: { lte: new Date(now.getTime() + 4 * 60 * 60_000) },
            },
            select: { id: true, administeredAt: true, prescriptionItemId: true },
            orderBy: { administeredAt: "asc" },
            take: 100,
          })
        : [];

      // ── Enriquecer con Patient (batch fetch único) ───────────────────────
      const patientIds = new Set<string>([
        ...rxToSign.map((r) => r.patientId),
        ...rxToDispense.map((r) => r.patientId),
        ...triages.map((t) => t.patientId),
        ...labs.map((l) => l.patientId),
        ...images.map((i) => i.patientId),
      ]);
      // PrescriptionItem → Drug + Prescription → patientId
      let medItemMap = new Map<
        string,
        { drugName: string; patientId: string | null }
      >();
      if (meds.length > 0) {
        const items = await prisma.prescriptionItem.findMany({
          where: { id: { in: meds.map((m) => m.prescriptionItemId) } },
          select: { id: true, drugId: true, prescriptionId: true },
        });
        const drugIds = items.map((i) => i.drugId);
        const presIds = items.map((i) => i.prescriptionId);
        const [drugs, prescs] = await Promise.all([
          drugIds.length > 0
            ? prisma.drug.findMany({
                where: { id: { in: drugIds } },
                select: { id: true, brandName: true, genericName: true },
              })
            : Promise.resolve([]),
          presIds.length > 0
            ? prisma.prescription.findMany({
                where: { id: { in: presIds } },
                select: { id: true, patientId: true },
              })
            : Promise.resolve([]),
        ]);
        const drugById = new Map(drugs.map((d) => [d.id, d.brandName ?? d.genericName]));
        const presById = new Map(prescs.map((p) => [p.id, p.patientId]));
        for (const it of items) {
          const pid = presById.get(it.prescriptionId) ?? null;
          if (pid) patientIds.add(pid);
          medItemMap.set(it.id, {
            drugName: drugById.get(it.drugId) ?? "Medicación",
            patientId: pid,
          });
        }
      }

      const patientsById = new Map<string, PatientMini>();
      if (patientIds.size > 0) {
        const patients = await prisma.patient.findMany({
          where: { id: { in: Array.from(patientIds) } },
          select: { id: true, firstName: true, lastName: true, mrn: true },
        });
        for (const p of patients) {
          patientsById.set(p.id, p);
        }
      }

      function getPatient(id: string | null | undefined): PatientMini | null {
        if (!id) return null;
        return patientsById.get(id) ?? null;
      }
      function fmtName(p: PatientMini | null): string | null {
        if (!p) return null;
        return `${p.firstName} ${p.lastName}`.trim() || null;
      }

      function buildTask(args: {
        type: TaskType;
        sourceId: string;
        createdAt: Date;
        patient: PatientMini | null;
        description: string;
        deepLink: string;
      }): Task {
        const age = ageInMinutes(args.createdAt, now);
        const sla = TASK_SLA_MINUTES[args.type];
        const remaining = sla === null ? null : sla - age;
        const isOverdue = remaining !== null && remaining < 0;
        return {
          id: `${args.type}:${args.sourceId}`,
          type: args.type,
          typeLabel: TASK_TYPE_LABEL[args.type],
          priority: derivePriority(age, sla),
          patientName: fmtName(args.patient),
          patientMrn: args.patient?.mrn ?? null,
          description: args.description,
          createdAt: args.createdAt,
          ageMinutes: age,
          remainingMinutes: remaining,
          isOverdue,
          deepLink: args.deepLink,
          requiredRoles: TASK_REQUIRED_ROLES[args.type],
        };
      }

      const tasks: Task[] = [
        ...rxToSign.map((r) =>
          buildTask({
            type: "PRESCRIPTION_TO_SIGN",
            sourceId: r.id,
            createdAt: r.prescribedAt,
            patient: getPatient(r.patientId),
            description: r.notes?.slice(0, 80) ?? "Receta borrador pendiente de firma",
            deepLink: `/pharmacy?prescription=${r.id}`,
          }),
        ),
        ...rxToDispense.map((r) =>
          buildTask({
            type: "PRESCRIPTION_TO_DISPENSE",
            sourceId: r.id,
            createdAt: r.signedAt ?? r.prescribedAt,
            patient: getPatient(r.patientId),
            description: "Receta firmada lista para dispensar",
            deepLink: `/pharmacy/dispense?prescription=${r.id}`,
          }),
        ),
        ...triages.map((t) =>
          buildTask({
            type: "TRIAGE_IN_PROGRESS",
            sourceId: t.id,
            createdAt: t.startedAt,
            patient: getPatient(t.patientId),
            description: `Triage ${t.assignedLevel.name} en curso`,
            deepLink: `/triage/${t.id}/discriminators`,
          }),
        ),
        ...labs.map((l) =>
          buildTask({
            type: "LAB_TO_PROCESS",
            sourceId: l.id,
            createdAt: l.orderedAt,
            patient: getPatient(l.patientId),
            description: "Orden de laboratorio pendiente de procesamiento",
            deepLink: `/lis/orders?id=${l.id}`,
          }),
        ),
        ...images.map((i) =>
          buildTask({
            type: "IMAGING_TO_REPORT",
            sourceId: i.id,
            createdAt: i.orderedAt,
            patient: getPatient(i.patientId),
            description: "Estudio de imagen completado, pendiente de reporte",
            deepLink: `/imaging?id=${i.id}`,
          }),
        ),
        ...meds.map((m) => {
          const item = medItemMap.get(m.prescriptionItemId);
          return buildTask({
            type: "MED_TO_ADMINISTER",
            sourceId: m.id,
            createdAt: m.administeredAt,
            patient: getPatient(item?.patientId ?? null),
            description: `Administrar ${item?.drugName ?? "medicación"}`,
            deepLink: `/emar?medAdmin=${m.id}`,
          });
        }),
      ];

      let filtered = tasks;
      if (filters.onlyOverdue) filtered = filtered.filter((t) => t.isOverdue);
      if (filters.priority) filtered = filtered.filter((t) => t.priority === filters.priority);

      const priorityRank: Record<TaskPriority, number> = {
        CRITICAL: 0,
        HIGH: 1,
        NORMAL: 2,
        LOW: 3,
      };
      filtered.sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        const pa = priorityRank[a.priority] - priorityRank[b.priority];
        if (pa !== 0) return pa;
        return b.ageMinutes - a.ageMinutes;
      });

      const allTypes: TaskType[] = [
        "PRESCRIPTION_TO_SIGN",
        "PRESCRIPTION_TO_DISPENSE",
        "TRIAGE_IN_PROGRESS",
        "LAB_TO_PROCESS",
        "LAB_TO_VALIDATE",
        "IMAGING_TO_REPORT",
        "IMAGING_TO_VALIDATE",
        "ECE_RECTIFICACION_PENDING",
        "ECE_DOC_TO_CERTIFY",
        "MED_TO_ADMINISTER",
      ];
      const countsByType = allTypes
        .map((t) => {
          const items = tasks.filter((task) => task.type === t);
          return {
            type: t,
            typeLabel: TASK_TYPE_LABEL[t],
            count: items.length,
            overdueCount: items.filter((task) => task.isOverdue).length,
          };
        })
        .filter((c) => c.count > 0);

      return {
        serverNow: now,
        totalTasks: tasks.length,
        overdueTasks: tasks.filter((t) => t.isOverdue).length,
        countsByType,
        tasks: filtered.slice(0, filters.limit),
      };
    }),

  /**
   * Contador rápido — solo total + overdue para badge del sidebar/header.
   */
  contadorBadge: tenantProcedure.query(
    async ({ ctx }): Promise<{ total: number; overdue: number }> => {
      const { prisma, tenant, user } = ctx;
      const userRoles = tenant.roleCodes;
      const orgId = tenant.organizationId;
      const now = new Date();

      function check(type: TaskType): boolean {
        return userHasAnyRole(userRoles, TASK_REQUIRED_ROLES[type]);
      }

      const counts = await Promise.all([
        check("PRESCRIPTION_TO_SIGN")
          ? prisma.prescription.count({
              where: { organizationId: orgId, status: "DRAFT", prescriberId: user.id },
            })
          : Promise.resolve(0),
        check("PRESCRIPTION_TO_DISPENSE")
          ? prisma.prescription.count({
              where: { organizationId: orgId, status: "SIGNED" },
            })
          : Promise.resolve(0),
        check("TRIAGE_IN_PROGRESS")
          ? prisma.triageEvaluation.count({
              where: {
                organizationId: orgId,
                ...(tenant.establishmentId
                  ? { establishmentId: tenant.establishmentId }
                  : {}),
                status: "IN_PROGRESS",
              },
            })
          : Promise.resolve(0),
        check("LAB_TO_PROCESS")
          ? prisma.labOrder.count({
              where: { organizationId: orgId, status: { in: ["ORDERED", "COLLECTED"] } },
            })
          : Promise.resolve(0),
        check("IMAGING_TO_REPORT")
          ? prisma.imagingOrder.count({
              where: { organizationId: orgId, status: "COMPLETED" },
            })
          : Promise.resolve(0),
        check("MED_TO_ADMINISTER")
          ? prisma.medicationAdministration.count({
              where: {
                organizationId: orgId,
                status: "SCHEDULED",
                administeredAt: { lte: new Date(now.getTime() + 4 * 60 * 60_000) },
              },
            })
          : Promise.resolve(0),
      ]);

      const total = counts.reduce((s, n) => s + n, 0);

      const overdueChecks = await Promise.all([
        check("PRESCRIPTION_TO_SIGN")
          ? prisma.prescription.count({
              where: {
                organizationId: orgId,
                status: "DRAFT",
                prescriberId: user.id,
                prescribedAt: {
                  lt: new Date(
                    now.getTime() - (TASK_SLA_MINUTES.PRESCRIPTION_TO_SIGN ?? 0) * 60_000,
                  ),
                },
              },
            })
          : Promise.resolve(0),
        check("TRIAGE_IN_PROGRESS")
          ? prisma.triageEvaluation.count({
              where: {
                organizationId: orgId,
                status: "IN_PROGRESS",
                startedAt: {
                  lt: new Date(
                    now.getTime() - (TASK_SLA_MINUTES.TRIAGE_IN_PROGRESS ?? 0) * 60_000,
                  ),
                },
              },
            })
          : Promise.resolve(0),
      ]);

      const overdue = overdueChecks.reduce((s, n) => s + n, 0);
      return { total, overdue };
    },
  ),
});
