/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Permitir importar paquetes del monorepo en src.
  transpilePackages: ["@his/ui", "@his/contracts", "@his/trpc", "@his/database"],
};

export default nextConfig;
