import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  patientCreateSchema,
  patientUpdateSchema,
  patientIdentifierSchema,
  patientAllergySchema,
  patientAddressSchema,
  patientSearchSchema,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

export const patientRouter = router({
  search: tenantProcedure.input(patientSearchSchema).query(async ({ ctx, input }) => {
    const q = input.query.trim();
    return ctx.prisma.patient.findMany({
      where: {
        organizationId: ctx.tenant.organizationId,
        deletedAt: null,
        OR: [
          { mrn: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { secondLastName: { contains: q, mode: "insensitive" } },
          { identifiers: { some: { value: { contains: q.replace(/\D/g, "") || q } } } },
        ],
      },
      take: input.limit,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: { identifiers: { take: 1, where: { isPrimary: true } } },
    });
  }),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const patient = await ctx.prisma.patient.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.tenant.organizationId,
          deletedAt: null,
        },
        include: {
          identifiers: { include: { identifierType: true } },
          addresses: true,
          phones: true,
          emails: true,
          emergencyContacts: true,
          allergies: { where: { active: true } },
          biologicalSex: true,
          gender: true,
          maritalStatus: true,
        },
      });
      if (!patient) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
      }
      return patient;
    }),

  create: tenantProcedure.input(patientCreateSchema).mutation(async ({ ctx, input }) => {
    return ctx.prisma.patient.create({
      data: {
        ...input,
        organizationId: ctx.tenant.organizationId,
        createdBy: ctx.user.id,
      },
    });
  }),

  update: tenantProcedure.input(patientUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, ...rest } = input;
    return ctx.prisma.patient.update({
      where: { id },
      data: { ...rest, updatedBy: ctx.user.id },
    });
  }),

  addIdentifier: tenantProcedure
    .input(z.object({ patientId: z.string().uuid(), data: patientIdentifierSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.patientIdentifier.create({
        data: { patientId: input.patientId, ...input.data },
      });
    }),

  addAllergy: tenantProcedure
    .input(z.object({ patientId: z.string().uuid(), data: patientAllergySchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.patientAllergy.create({
        data: {
          patientId: input.patientId,
          ...input.data,
          createdBy: ctx.user.id,
        },
      });
    }),

  addAddress: tenantProcedure
    .input(z.object({ patientId: z.string().uuid(), data: patientAddressSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.patientAddress.create({
        data: { patientId: input.patientId, ...input.data },
      });
    }),
});
