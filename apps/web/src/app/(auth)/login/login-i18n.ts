/**
 * Diccionario ES/EN de la tarjeta de login — portado literal de
 * `docs/CC/0010/axismedlogin.html` (líneas 304-341), extendido con las claves
 * nuevas que exige la lógica real de autenticación (SSO Microsoft, stub
 * biométrico, mensajes de error/lockout) — ver CC-0010 punto 11.
 */

export type Lang = "es" | "en";

export interface I18nStrings {
  title: string;
  user: string;
  userPh: string;
  pass: string;
  passPh: string;
  showPass: string;
  hidePass: string;
  remember: string;
  forgot: string;
  login: string;
  loggingIn: string;
  or: string;
  bio: string;
  bioSoon: string;
  err: string;
  banner: string;
  sede: string;
  sedePh: string;
  enterSite: string;
  entering: string;
  back: string;
  mTitle: string;
  mBody: string;
  mCancel: string;
  mOk: string;
  restart: string;
  microsoft: string;
  microsoftRedirecting: string;
  microsoftError: string;
  noEstablishments: string;
  callbackErrors: {
    notAuthorized: (email: string | null) => string;
    accountInactive: (email: string | null) => string;
    missingEmail: string;
    unsupportedProvider: string;
    exchangeFailed: (description: string | null) => string;
    invalidCallback: string;
    generic: (code: string, description: string | null) => string;
  };
  accountLocked: (untilLabel: string, minutesLeft: number) => string;
  attemptsExceeded: (untilLabel: string) => string;
  remainingAttempts: (n: number) => string;
  passwordRecovered: string;
}

export const I18N: Record<Lang, I18nStrings> = {
  es: {
    title: "Sistema de Información Hospitalaria",
    user: "Usuario (correo)",
    userPh: "usuario.avante",
    pass: "Contraseña",
    passPh: "••••••••",
    showPass: "Ver contraseña",
    hidePass: "Ocultar contraseña",
    remember: "Recordarme",
    forgot: "¿Olvidó su contraseña?",
    login: "Ingresar al sistema",
    loggingIn: "Ingresando…",
    or: "o ingrese con",
    bio: "Ingreso biométrico",
    bioSoon: "Ingreso biométrico disponible próximamente",
    err: "Ingrese usuario y contraseña",
    banner: "✓ Acceso concedido — seleccione su sede",
    sede: "Sede",
    sedePh: "Seleccione la sede",
    enterSite: "Ingresar a la sede",
    entering: "✓ Ingresando…",
    back: "← Volver al inicio de sesión",
    mTitle: "Confirmar dispositivo seguro",
    mBody:
      "Al activar «Recordarme», sus credenciales se recordarán en este equipo. ¿Confirma que este es un dispositivo seguro y de uso personal?",
    mCancel: "Cancelar",
    mOk: "Sí, es seguro",
    restart: "↻ Reiniciar animación",
    microsoft: "Iniciar sesión con Microsoft",
    microsoftRedirecting: "Redirigiendo…",
    microsoftError: "No pudimos iniciar el flujo con Microsoft",
    noEstablishments: "No tiene sedes activas asignadas. Contacte al administrador.",
    callbackErrors: {
      notAuthorized: (email) =>
        email
          ? `La cuenta ${email} no está registrada en el HIS. Solicita al administrador que la dé de alta antes de iniciar sesión con Microsoft.`
          : "Tu cuenta Microsoft no está registrada en el HIS. Solicita al administrador que la dé de alta.",
      accountInactive: (email) =>
        email
          ? `La cuenta ${email} está inactiva. Contacta al administrador.`
          : "Tu cuenta HIS está inactiva. Contacta al administrador.",
      missingEmail:
        "Microsoft no devolvió un email. Verifica que tu cuenta tenga email principal configurado.",
      unsupportedProvider: "Proveedor de inicio de sesión no soportado.",
      exchangeFailed: (description) =>
        description
          ? `No pudimos completar el login con Microsoft: ${description}`
          : "No pudimos completar el login con Microsoft. Reintenta.",
      invalidCallback: "Callback de inicio de sesión inválido.",
      generic: (code, description) => description ?? `Error de inicio de sesión: ${code}`,
    },
    accountLocked: (untilLabel, minutesLeft) =>
      `Cuenta bloqueada hasta las ${untilLabel}. Intenta de nuevo en ${minutesLeft} ${minutesLeft === 1 ? "minuto" : "minutos"}.`,
    attemptsExceeded: (untilLabel) =>
      `Has superado el número de intentos. Cuenta bloqueada hasta las ${untilLabel} (15 minutos).`,
    remainingAttempts: (n) =>
      `Te ${n === 1 ? "queda" : "quedan"} ${n} ${n === 1 ? "intento" : "intentos"} antes del bloqueo de 15 min.`,
    passwordRecovered: "Contraseña actualizada. Inicia sesión con la nueva.",
  },
  en: {
    title: "Hospital Information System",
    user: "Username (email)",
    userPh: "avante.user",
    pass: "Password",
    passPh: "••••••••",
    showPass: "Show password",
    hidePass: "Hide password",
    remember: "Remember me",
    forgot: "Forgot your password?",
    login: "Enter the system",
    loggingIn: "Signing in…",
    or: "or sign in with",
    bio: "Biometric sign-in",
    bioSoon: "Biometric sign-in coming soon",
    err: "Enter username and password",
    banner: "✓ Access granted — select your site",
    sede: "Site",
    sedePh: "Select a site",
    enterSite: "Enter site",
    entering: "✓ Signing in…",
    back: "← Back to sign in",
    mTitle: "Confirm trusted device",
    mBody:
      "When you enable “Remember me”, your credentials will be stored on this computer. Do you confirm this is a secure, personal device?",
    mCancel: "Cancel",
    mOk: "Yes, it is secure",
    restart: "↻ Replay animation",
    microsoft: "Sign in with Microsoft",
    microsoftRedirecting: "Redirecting…",
    microsoftError: "We couldn't start the Microsoft sign-in flow",
    noEstablishments: "You have no active sites assigned. Contact your administrator.",
    callbackErrors: {
      notAuthorized: (email) =>
        email
          ? `The account ${email} is not registered in the HIS. Ask an administrator to create it before signing in with Microsoft.`
          : "Your Microsoft account is not registered in the HIS. Ask an administrator to create it.",
      accountInactive: (email) =>
        email
          ? `The account ${email} is inactive. Contact your administrator.`
          : "Your HIS account is inactive. Contact your administrator.",
      missingEmail:
        "Microsoft did not return an email. Verify your account has a primary email configured.",
      unsupportedProvider: "Unsupported sign-in provider.",
      exchangeFailed: (description) =>
        description
          ? `We couldn't complete the Microsoft sign-in: ${description}`
          : "We couldn't complete the Microsoft sign-in. Try again.",
      invalidCallback: "Invalid sign-in callback.",
      generic: (code, description) => description ?? `Sign-in error: ${code}`,
    },
    accountLocked: (untilLabel, minutesLeft) =>
      `Account locked until ${untilLabel}. Try again in ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"}.`,
    attemptsExceeded: (untilLabel) =>
      `You exceeded the number of attempts. Account locked until ${untilLabel} (15 minutes).`,
    remainingAttempts: (n) =>
      `You have ${n} ${n === 1 ? "attempt" : "attempts"} left before a 15 min lockout.`,
    passwordRecovered: "Password updated. Sign in with the new one.",
  },
};
