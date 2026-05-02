/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Permitir importar paquetes del monorepo en src.
  transpilePackages: ["@his/ui", "@his/contracts", "@his/trpc", "@his/database"],
  // ESLint NO bloquea el build — typecheck es el gate de tipo.
  // Lint se corre en CI separado (ver .github/workflows/ci.yml).
  // Razón: agentes paralelos del Sprint 1 introdujeron `// eslint-disable-next-line
  // @typescript-eslint/no-explicit-any` y el plugin TS no está cargado en nuestro
  // preset 'next/core-web-vitals' minimal. Re-introducir en Sprint 2 con el
  // shared @his/eslint-config completamente publicado.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
