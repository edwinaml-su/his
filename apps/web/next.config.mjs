/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    optimizePackageImports: ["lucide-react", "@his/ui"],
    // Native .node binaries — webpack no sabe bundlear @node-rs/argon2.
    serverComponentsExternalPackages: ["@node-rs/argon2"],
    // Habilita la View Transitions API del navegador en navegaciones de ruta.
    // Degradación elegante: browsers sin soporte navegan instantáneamente.
    // Animaciones desactivadas con `prefers-reduced-motion` (ver globals.css Tarea 8).
    viewTransition: true,
  },
  // Permitir importar paquetes del monorepo en src.
  transpilePackages: ["@his/ui", "@his/contracts", "@his/trpc", "@his/database", "@his/infrastructure"],
  // ESLint NO bloquea el build — typecheck es el gate de tipo.
  // Lint se corre en CI separado (ver .github/workflows/ci.yml).
  // Razón: agentes paralelos del Sprint 1 introdujeron `// eslint-disable-next-line
  // @typescript-eslint/no-explicit-any` y el plugin TS no está cargado en nuestro
  // preset 'next/core-web-vitals' minimal. Re-introducir en Sprint 2 con el
  // shared @his/eslint-config completamente publicado.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Security Headers HTTP — OWASP A05
  //
  // CSP en ENFORCE mode (promovido de report-only en Sprint 4 Beta.21,
  // tras 1 semana sin violaciones bloqueantes reportadas).
  //
  // DECISIONES DE DISEÑO:
  //  - 'unsafe-inline' en script-src: requerido por Next.js 14 App Router
  //    para hidratación SSR. Eliminar requeriría nonce-based CSP con middleware
  //    custom — scope Sprint 5.
  //  - 'unsafe-eval' en script-src: incluido SOLO en desarrollo (NODE_ENV=development)
  //    para hot-reload. En producción se omite. Next.js 14 prod build no lo necesita.
  //  - 'unsafe-eval' en worker-src/script-src de dev: necesario para el webpack HMR.
  //
  // ROLLBACK: cambiar la key de "Content-Security-Policy" a
  //           "Content-Security-Policy-Report-Only" y redeploy.
  //
  // Supabase SDK usa: connect-src *.supabase.co wss://*.supabase.co,
  //                   img-src *.supabase.co, frame-src *.supabase.co
  // Vercel Analytics: script-src *.vercel-insights.com,
  //                   connect-src *.vercel-insights.com
  // Sentry SDK:       connect-src *.ingest.sentry.io
  // ─────────────────────────────────────────────────────────────────────────
  async headers() {
    const isDev = process.env.NODE_ENV === "development";

    // Enforce CSP — aplicado en producción y preview
    const cspEnforce = [
      "default-src 'self'",
      // 'unsafe-inline' necesario para Next.js SSR. 'unsafe-eval' solo en dev.
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.vercel-insights.com"
        : "script-src 'self' 'unsafe-inline' https://*.vercel-insights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-insights.com https://*.ingest.sentry.io",
      "frame-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    // Report-Only más estricto: sin 'unsafe-eval', sin dominios legacy.
    // Permite detectar futuras relajaciones antes de que lleguen a enforce.
    const cspReportOnly = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://*.vercel-insights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-insights.com https://*.ingest.sentry.io",
      "frame-src 'self' https://*.supabase.co",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            // ENFORCE — bloquea violaciones activamente.
            // Rollback: cambiar key a "Content-Security-Policy-Report-Only".
            key: "Content-Security-Policy",
            value: cspEnforce,
          },
          {
            // Report-Only más estricto: detecta nuevas violaciones antes de enforce.
            // Monitorear en Sentry con tag csp-violation.
            key: "Content-Security-Policy-Report-Only",
            value: cspReportOnly,
          },
        ],
      },
    ];
  },
  // Redirects permanentes para módulos consolidados.
  // `/ece/triaje` fue creado erróneamente como duplicado de `/triage` legacy en
  // F2-S2. El bridge `eceBridgeTriage` (PR #93) ya sincroniza Triage HIS →
  // `ece.hoja_triaje`, así que el módulo legacy cubre el dominio completo
  // NTEC + ISSS. Regla permanente: ver memoria `feedback_adecuar_no_duplicar`
  // + CLAUDE.md §"Adecuar vs duplicar".
  async redirects() {
    return [
      {
        source: "/ece/triaje",
        destination: "/triage",
        permanent: true,
      },
      {
        source: "/ece/triaje/:path*",
        destination: "/triage",
        permanent: true,
      },
      // Safari macOS intenta /site.webmanifest además del estándar /manifest.json.
      // Sin este alias recibe el HTML 404 y lanza "Parsing application manifest:
      // The manifest is not valid JSON data" en consola.
      {
        source: "/site.webmanifest",
        destination: "/manifest.json",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
