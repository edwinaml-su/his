/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    optimizePackageImports: ["lucide-react", "@his/ui"],
    // Native .node binaries — webpack no sabe bundlear @node-rs/argon2.
    serverComponentsExternalPackages: ["@node-rs/argon2"],
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
    ];
  },
};

export default nextConfig;
