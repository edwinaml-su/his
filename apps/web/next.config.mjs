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
  // Security Headers HTTP — OWASP A05 (cierra hallazgo pentest 2026-05-30)
  //
  // CSP en modo report-only: NO enforce inicial para no romper scripts inline
  // de Next.js 14 / Supabase / Vercel Analytics. Promover a enforce después
  // de validar que el report-uri no arroja falsos positivos en staging.
  //
  // Supabase Studio y los SDK usan:
  //   - connect-src: *.supabase.co, wss://*.supabase.co
  //   - img-src: *.supabase.co (storage public)
  //   - frame-src: *.supabase.co (auth flows)
  //
  // Vercel Analytics / Speed Insights usan:
  //   - script-src: *.vercel-insights.com
  //   - connect-src: *.vercel-insights.com
  // ─────────────────────────────────────────────────────────────────────────
  async headers() {
    const cspDirectives = [
      "default-src 'self'",
      // Next.js requiere 'unsafe-inline' para styles en SSR y 'unsafe-eval'
      // en desarrollo (hot-reload). En producción 'unsafe-eval' no se necesita
      // pero mantenemos report-only para no bloquear nada aún.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.vercel-insights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-insights.com",
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
            // Modo report-only: observar sin bloquear. Promover a
            // Content-Security-Policy cuando los reports sean limpios.
            key: "Content-Security-Policy-Report-Only",
            value: cspDirectives,
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
