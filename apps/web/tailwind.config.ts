import type { Config } from "tailwindcss";
import preset from "@his/ui/tailwind.config";

/**
 * Web app extiende el preset @his/ui añadiendo sus propias rutas de contenido.
 */
const config: Config = {
  ...preset,
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
