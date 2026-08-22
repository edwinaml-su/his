"use client";

import * as React from "react";
import Link from "next/link";
import { Sora } from "next/font/google";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isAccountLocked, recordLoginAttempt } from "@/app/actions/login-policy";
import { setEstablishment } from "@/app/actions/set-establishment";
import { trpc } from "@/lib/trpc/react";
import styles from "./login.module.css";
import { LoginStage } from "./login-stage";
import { I18N, type I18nStrings, type Lang } from "./login-i18n";

/**
 * CC-0010 — Login AxisMed. Reemplaza el form shadcn genérico anterior por la
 * réplica fiel de `docs/CC/0010/axismedlogin.html` (animación + tarjeta),
 * conservando la lógica real de autenticación del page.tsx previo:
 * lockout local (login-policy), Supabase signInWithPassword, SSO Microsoft,
 * y ahora selección de sede real (organization.listMine + setEstablishment)
 * en vez de las 4 sedes hardcoded del mockup.
 *
 * Fuente de verdad visual: docs/CC/0010/axismedlogin.html. Cualquier
 * desviación está documentada en el reporte de la PR (SSO añadido,
 * biométrico stub, sedes reales, type=email, back = signOut real).
 */

// Next/font: self-hosted por Next (CSP-safe, sin <link> a fonts.googleapis.com).
// Aplicada SOLO al login vía className en el wrapper — no toca font-sans global.
const sora = Sora({ subsets: ["latin"], weight: ["400", "600", "700"], display: "swap" });

/** Umbral en el que mostramos el warning "te quedan N intentos". */
const LOW_ATTEMPTS_WARNING_THRESHOLD = 2;

/** Feature flag para mostrar el botón "Iniciar con Microsoft". Por default ON
 *  porque el provider ya está configurado en Supabase; el flag permite
 *  desactivarlo temporal sin redeploy si surge incidente. */
const MICROSOFT_LOGIN_ENABLED =
  (process.env.NEXT_PUBLIC_AUTH_MICROSOFT_ENABLED ?? "true").toLowerCase() !== "false";

/** localStorage key del flag cosmético de "Recordarme" (CC-0010 punto 9). */
const REMEMBER_DEVICE_KEY = "axismed.rememberDevice";

/** Formatea HH:MM en horario local del navegador para el aviso de lock. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

type AuthError =
  | { kind: "none" }
  | { kind: "validation" }
  | { kind: "callback"; code: string; email: string | null; description: string | null }
  | { kind: "locked"; until: Date; minutesLeft: number }
  | { kind: "exceeded"; until: Date }
  | { kind: "supabase"; message: string }
  | { kind: "microsoft"; message: string };

function describeAuthError(t: I18nStrings, err: AuthError): string | null {
  switch (err.kind) {
    case "none":
      return null;
    case "validation":
      return t.err;
    case "callback": {
      const c = t.callbackErrors;
      switch (err.code) {
        case "not_authorized":
          return c.notAuthorized(err.email);
        case "account_inactive":
          return c.accountInactive(err.email);
        case "missing_email":
          return c.missingEmail;
        case "unsupported_provider":
          return c.unsupportedProvider;
        case "exchange_failed":
          return c.exchangeFailed(err.description);
        case "invalid_callback":
          return c.invalidCallback;
        default:
          return c.generic(err.code, err.description);
      }
    }
    case "locked":
      return t.accountLocked(formatTime(err.until), err.minutesLeft);
    case "exceeded":
      return t.attemptsExceeded(formatTime(err.until));
    case "supabase":
      return err.message;
    case "microsoft":
      return `${t.microsoftError}: ${err.message}`;
  }
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/dashboard";
  const skipIntroParam = params.get("skipIntro") === "1";
  const callbackError = params.get("error");
  const callbackEmail = params.get("email");
  const callbackErrorDescription = params.get("error_description");
  const recovered = params.get("recovered") === "true";

  const [lang, setLang] = React.useState<Lang>("es");
  const t = I18N[lang];

  // ---- Skip de animación: reduced-motion o ?skipIntro=1 (CC-0010 punto 4) ----
  const [reducedMotion, setReducedMotion] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const skip = skipIntroParam || reducedMotion;

  const [animKey, setAnimKey] = React.useState(0);
  const [showCard, setShowCard] = React.useState(skipIntroParam);
  React.useEffect(() => {
    if (skip) setShowCard(true);
  }, [skip]);
  const handleRestart = React.useCallback(() => {
    setShowCard(skip);
    setAnimKey((k) => k + 1);
  }, [skip]);

  // ---- Paso 1: autenticación ----
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [remember, setRemember] = React.useState(false);
  const [secModalOpen, setSecModalOpen] = React.useState(false);
  const [bioSoon, setBioSoon] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [msLoading, setMsLoading] = React.useState(false);
  const [authSuccess, setAuthSuccess] = React.useState(false);
  const [remainingAttempts, setRemainingAttempts] = React.useState<number | null>(null);
  const [success] = React.useState<boolean>(recovered);
  const [authErr, setAuthErr] = React.useState<AuthError>(() =>
    callbackError
      ? { kind: "callback", code: callbackError, email: callbackEmail, description: callbackErrorDescription }
      : { kind: "none" },
  );
  const modalOkRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (secModalOpen) modalOkRef.current?.focus();
  }, [secModalOpen]);

  const authErrorText = describeAuthError(t, authErr);
  const warningText = remainingAttempts !== null ? t.remainingAttempts(remainingAttempts) : null;

  function clearFeedback() {
    setAuthErr((prev) => (prev.kind === "none" ? prev : { kind: "none" }));
    setRemainingAttempts(null);
  }

  const onEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    clearFeedback();
  };
  const onPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    clearFeedback();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setAuthErr({ kind: "validation" });
      return;
    }
    clearFeedback();
    setLoading(true);

    // 1) Pre-check: si la cuenta está bloqueada localmente, no gastamos
    //    request a Supabase (y evitamos que un atacante use el endpoint
    //    de auth para timing).
    try {
      const lockStatus = await isAccountLocked(email);
      if (lockStatus.locked && lockStatus.until && lockStatus.minutesLeft) {
        setAuthErr({ kind: "locked", until: lockStatus.until, minutesLeft: lockStatus.minutesLeft });
        setLoading(false);
        return;
      }
    } catch {
      // Si la consulta de policy falla, NO bloqueamos el login: degradamos
      // graciosamente y dejamos que Supabase decida.
    }

    // 2) Intento real contra Supabase.
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });

    // 3) Registrar el resultado para mantener contadores. Best-effort.
    let attemptResult: Awaited<ReturnType<typeof recordLoginAttempt>> = {};
    try {
      attemptResult = await recordLoginAttempt(email, !err);
    } catch {
      // ignoramos: la UX no debe romperse por un fallo de telemetría
    }

    setLoading(false);

    if (err) {
      if (attemptResult.locked && attemptResult.until) {
        setAuthErr({ kind: "exceeded", until: attemptResult.until });
      } else {
        setAuthErr({ kind: "supabase", message: err.message });
        if (
          typeof attemptResult.remainingAttempts === "number" &&
          attemptResult.remainingAttempts > 0 &&
          attemptResult.remainingAttempts <= LOW_ATTEMPTS_WARNING_THRESHOLD
        ) {
          setRemainingAttempts(attemptResult.remainingAttempts);
        }
      }
      return;
    }

    setAuthSuccess(true);
  };

  const onMicrosoftSignIn = async () => {
    setMsLoading(true);
    clearFeedback();
    const supabase = createSupabaseBrowserClient();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const next = encodeURIComponent(redirect);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${origin}/sso/callback?next=${next}`,
        scopes: "email profile openid offline_access",
      },
    });
    if (err) {
      setAuthErr({ kind: "microsoft", message: err.message });
      setMsLoading(false);
    }
    // Si no hubo error, el navegador ya está siendo redirigido a Microsoft.
  };

  const onBioClick = () => {
    setBioSoon(true);
  };

  const onRememberChange = (checked: boolean) => {
    if (checked) {
      setSecModalOpen(true);
      return;
    }
    setRemember(false);
    try {
      window.localStorage.removeItem(REMEMBER_DEVICE_KEY);
    } catch {
      // localStorage puede fallar en modo privado — cosmético, no bloqueamos.
    }
  };
  const onModalCancel = () => {
    setRemember(false);
    setSecModalOpen(false);
  };
  const onModalConfirm = () => {
    setRemember(true);
    try {
      window.localStorage.setItem(REMEMBER_DEVICE_KEY, "1");
    } catch {
      // idem — cosmético/auditable, ver CC-0010 punto 9.
    }
    setSecModalOpen(false);
  };

  // ---- Paso 2: selección de sede real (CC-0010 punto 6) ----
  const [step, setStep] = React.useState<"auth" | "sede">("auth");
  const [selectedEstablishmentId, setSelectedEstablishmentId] = React.useState("");
  const [entering, setEntering] = React.useState(false);
  const autoAdvancedRef = React.useRef(false);

  const establishmentsQuery = trpc.organization.listMine.useQuery(undefined, {
    enabled: authSuccess,
  });

  const sedeOptions = React.useMemo(() => {
    const orgs = establishmentsQuery.data ?? [];
    const multiOrg = orgs.length > 1;
    const options: { id: string; label: string }[] = [];
    for (const org of orgs) {
      for (const est of org.establishments) {
        options.push({
          id: est.id,
          label: multiOrg ? `${org.tradeName ?? org.legalName} — ${est.name}` : est.name,
        });
      }
    }
    return options;
  }, [establishmentsQuery.data]);

  function finishLogin() {
    router.replace(redirect);
    router.refresh();
  }

  const confirmEstablishment = React.useCallback(
    async (establishmentId: string) => {
      setEntering(true);
      try {
        await setEstablishment(establishmentId);
      } catch {
        // Best-effort: si falla, el tenant-context por defecto del server
        // (primera membresía/establecimiento activo) igual resuelve algo
        // razonable — no dejamos al usuario varado en la tarjeta.
      }
      finishLogin();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Auto-avance: 1 sede -> entra directo; 0 sedes -> deja el default del
  // tenant-context; >1 -> muestra el paso 2 (select).
  React.useEffect(() => {
    if (!authSuccess || !establishmentsQuery.isSuccess || autoAdvancedRef.current) return;
    autoAdvancedRef.current = true;
    if (sedeOptions.length === 1) {
      void confirmEstablishment(sedeOptions[0]!.id);
    } else if (sedeOptions.length === 0) {
      finishLogin();
    } else {
      setStep("sede");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSuccess, establishmentsQuery.isSuccess, sedeOptions]);

  const onBackToLogin = async () => {
    try {
      await createSupabaseBrowserClient().auth.signOut();
    } catch {
      // best-effort
    }
    setAuthSuccess(false);
    setStep("auth");
    setEntering(false);
    setSelectedEstablishmentId("");
    autoAdvancedRef.current = false;
    setPassword("");
  };

  const successText = success ? t.passwordRecovered : null;

  return (
    <div className={`${styles.vars} ${sora.className}`}>
      <div className={styles.app}>
        <LoginStage key={animKey} skip={skip} onReachCardStep={() => setShowCard(true)} />

        <section
          className={[styles.loginCard, showCard && styles.show].filter(Boolean).join(" ")}
          aria-label={lang === "es" ? "Inicio de sesión" : "Sign in"}
        >
          <div className={styles.cardHead}>
            <h1 className={styles.cardTitle}>{t.title}</h1>
            <div className={styles.langPill} role="group" aria-label="Idioma / Language">
              <button
                type="button"
                className={lang === "es" ? styles.active : undefined}
                onClick={() => setLang("es")}
              >
                ES
              </button>
              <button
                type="button"
                className={lang === "en" ? styles.active : undefined}
                onClick={() => setLang("en")}
              >
                EN
              </button>
            </div>
          </div>

          {step === "auth" && (
            <form className={styles.step} onSubmit={onSubmit} noValidate>
              <label className={styles.fld} htmlFor="loginEmail">
                <span>{t.user}</span>
                <input
                  id="loginEmail"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={onEmailChange}
                />
              </label>
              <div className={styles.fld}>
                {/* El botón de mostrar/ocultar NO puede vivir dentro de este
                    <label> aunque el mockup lo dibuje pegado al input: un
                    control interactivo anidado en el <label> de OTRO control
                    se suma al cálculo del nombre accesible del input
                    (termina anunciándose "Contraseña Ver contraseña") y,
                    peor, hace que getByLabel/lectores de pantalla no puedan
                    distinguir el input del botón — ambos "responden" a
                    /contraseña/i. Por eso el <label> cierra antes del botón;
                    el layout visual (position:absolute vía .passWrap) no
                    depende de la jerarquía DOM y queda idéntico al mockup. */}
                <label htmlFor="loginPassword">{t.pass}</label>
                <span className={styles.passWrap}>
                  <input
                    id="loginPassword"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={onPasswordChange}
                  />
                  <button
                    type="button"
                    className={styles.eyeBtn}
                    aria-label={showPassword ? t.hidePass : t.showPass}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </button>
                </span>
              </div>
              <div className={styles.rowBetween}>
                <label className={styles.chk}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => onRememberChange(e.target.checked)}
                  />
                  <span>{t.remember}</span>
                </label>
                <Link href="/recover" className={styles.link}>
                  {t.forgot}
                </Link>
              </div>

              {authErrorText && (
                <div role="alert" className={styles.errorMsg}>
                  {authErrorText}
                </div>
              )}
              {!authErrorText && warningText && <div className={styles.warnBanner}>{warningText}</div>}
              {!authErrorText && !warningText && successText && (
                <div className={styles.okBanner}>{successText}</div>
              )}

              <button type="submit" className={styles.btnPri} disabled={loading || msLoading}>
                {loading ? t.loggingIn : t.login}
              </button>

              <div className={styles.divider}>
                <span>{t.or}</span>
              </div>

              <button
                type="button"
                className={styles.btnSec}
                onClick={onBioClick}
                disabled={loading || msLoading}
              >
                <FingerprintIcon />
                <span>{t.bio}</span>
              </button>
              {bioSoon && <div className={styles.warnBanner}>{t.bioSoon}</div>}

              {MICROSOFT_LOGIN_ENABLED && (
                <button
                  type="button"
                  className={styles.btnSec}
                  onClick={onMicrosoftSignIn}
                  disabled={loading || msLoading}
                  aria-label={t.microsoft}
                >
                  <MicrosoftIcon />
                  <span>{msLoading ? t.microsoftRedirecting : t.microsoft}</span>
                </button>
              )}
            </form>
          )}

          {step === "sede" && (
            <div className={styles.step}>
              <div className={styles.okBanner}>{t.banner}</div>
              <label className={styles.fld} htmlFor="loginSede">
                <span>{t.sede}</span>
                <select
                  id="loginSede"
                  value={selectedEstablishmentId}
                  onChange={(e) => setSelectedEstablishmentId(e.target.value)}
                >
                  <option value="">{t.sedePh}</option>
                  {sedeOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={styles.btnPri}
                disabled={!selectedEstablishmentId || entering}
                onClick={() => void confirmEstablishment(selectedEstablishmentId)}
              >
                {entering ? t.entering : t.enterSite}
              </button>
              <button type="button" className={styles.backLink} onClick={() => void onBackToLogin()}>
                {t.back}
              </button>
            </div>
          )}

          <div className={styles.cardFoot}>© 2026 Avante · AxisMed</div>
        </section>

        {secModalOpen && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="secModalTitle">
              <div id="secModalTitle" className={styles.modalTitle}>
                {t.mTitle}
              </div>
              <div className={styles.modalBody}>{t.mBody}</div>
              <div className={styles.modalBtns}>
                <button type="button" className={styles.btnSec} onClick={onModalCancel}>
                  {t.mCancel}
                </button>
                <button type="button" ref={modalOkRef} className={styles.btnPri} onClick={onModalConfirm}>
                  {t.mOk}
                </button>
              </div>
            </div>
          </div>
        )}

        <button type="button" className={styles.restartBtn} onClick={handleRestart}>
          {t.restart}
        </button>
      </div>
    </div>
  );
}

function EyeOpenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeClosedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7c2.1 0 3.9.7 5.4 1.7M22 12s-3.5 7-10 7c-2.1 0-3.9-.7-5.4-1.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M12 4a8 8 0 0 0-8 8c0 2.5.6 4.6 1.5 6.4" />
      <path d="M12 4a8 8 0 0 1 8 8c0 2.5-.6 4.6-1.5 6.4" />
      <path d="M12 7.5a4.5 4.5 0 0 0-4.5 4.5c0 2.2.5 4.2 1.4 5.9" />
      <path d="M12 7.5a4.5 4.5 0 0 1 4.5 4.5c0 2.2-.5 4.2-1.4 5.9" />
      <path d="M12 11a1.2 1.2 0 0 0-1.2 1.2c0 2 .4 3.9 1.2 5.6" />
      <path d="M12 11a1.2 1.2 0 0 1 1.2 1.2c0 2-.4 3.9-1.2 5.6" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}
