import { router } from "../trpc";
import { countryRouter } from "./country.router";
import { organizationRouter } from "./organization.router";
import { currencyRouter } from "./currency.router";
import { patientRouter } from "./patient.router";
import { encounterRouter } from "./encounter.router";
import { bedRouter } from "./bed.router";
import { triageRouter } from "./triage.router";
import { catalogRouter } from "./catalog.router";
import { auditRouter } from "./audit.router";

export const appRouter = router({
  country: countryRouter,
  organization: organizationRouter,
  currency: currencyRouter,
  patient: patientRouter,
  encounter: encounterRouter,
  bed: bedRouter,
  triage: triageRouter,
  catalog: catalogRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
