import { router, publicProcedure } from "../trpc";

export const countryRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.country.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
  }),
});
