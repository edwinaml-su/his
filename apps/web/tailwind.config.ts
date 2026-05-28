import type { Config } from "tailwindcss";
import preset from "@his/ui/tailwind.config";

/**
 * Web app extiende el preset @his/ui añadiendo sus propias rutas de contenido.
 *
 * Patrón oficial Tailwind: usar `presets: [preset]` en lugar de spread. El
 * spread shallow `{ ...preset }` puede no merge correctamente las claves
 * profundas de `theme.extend` cuando se agregan nuevos tokens al preset
 * (ej. grupo `sidebar` en PR #314). `presets` hace deep-merge correcto y
 * garantiza que TODAS las clases del preset se generan en cada build.
 */
const config: Config = {
  presets: [preset],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
