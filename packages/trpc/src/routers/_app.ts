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
import { breakGlassRouter } from "./break-glass.router";
import { consentRouter } from "./consent.router";
import { mfaRouter } from "./mfa.router";
import { exchangeRateRouter } from "./exchange-rate.router";
import { rbacRouter } from "./rbac.router";
import { userAdminRouter } from "./user-admin.router";
import { localeRouter } from "./locale.router";
import { ledgerRouter } from "./ledger.router";
import { auditIntegrityRouter } from "./audit-integrity.router";

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
  breakGlass: breakGlassRouter,
  consent: consentRouter,
  mfa: mfaRouter,
  exchangeRate: exchangeRateRouter,
  rbac: rbacRouter,
  userAdmin: userAdminRouter,
  locale: localeRouter,
  ledger: ledgerRouter,
  auditIntegrity: auditIntegrityRouter,
});

export type AppRouter = typeof appRouter;
