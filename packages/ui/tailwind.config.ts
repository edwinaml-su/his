import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";
import containerQueries from "@tailwindcss/container-queries";

/**
 * Tailwind config base del paquete `@his/ui` (HIS Multipaís).
 * Las apps (`apps/web`, `apps/mobile`) extienden este preset y añaden su propio `content`.
 *
 * v2.0 (rediseño visual):
 * - Colores semánticos: variables OKLCH en `globals.css` (light/dark).
 * - Superficie: bg-surface-0/1/2/3 para capas de elevación.
 * - Radios: rounded-sm/md/lg/xl mapeados a variables --radius-*.
 * - Movimiento: transition-fast/base/slow con easing estándar.
 * - Triage Manchester: paleta fija auditada WCAG AA (ver docs/07_design_system.md §2.2).
 * - Dark mode: `class` strategy.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{ts,tsx}",
    // Las apps que consuman este preset deben agregar sus propias rutas.
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Tokens semánticos Shadcn (resueltos vía CSS variables OKLCH).
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        // Superficie / elevación (Tarea 1 v2.0).
        surface: {
          "0": "var(--surface-0)",
          "1": "var(--surface-1)",
          "2": "var(--surface-2)",
          "3": "var(--surface-3)",
        },
        // Estados clínicos semánticos.
        success: {
          DEFAULT: "var(--success)",
          foreground: "var(--success-foreground)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          foreground: "var(--warning-foreground)",
        },
        critical: {
          DEFAULT: "var(--critical)",
          foreground: "var(--critical-foreground)",
        },
        info: {
          DEFAULT: "var(--info)",
          foreground: "var(--info-foreground)",
        },
        // Banners clínicos especiales (no colisionan con triage).
        lasa: {
          DEFAULT: "var(--lasa)",
          foreground: "var(--lasa-foreground)",
        },
        allergy: {
          DEFAULT: "var(--allergy)",
          foreground: "var(--allergy-foreground)",
        },
        lila: {
          DEFAULT: "var(--lila)",
          foreground: "var(--lila-fg)",
        },
        // Sidebar — branding Avante navy. Sin este mapeo, las clases
        // bg-sidebar-background etc. no se generan y el sidebar pierde fondo.
        // DEFAULT y primary/ring añadidos en Tarea 2b para primitivos Shadcn sidebar.
        sidebar: {
          DEFAULT: "var(--sidebar)",
          background: "var(--sidebar-background)",
          foreground: "var(--sidebar-foreground)",
          border: "var(--sidebar-border)",
          primary: {
            DEFAULT: "var(--sidebar-primary)",
            foreground: "var(--sidebar-primary-foreground)",
          },
          accent: {
            DEFAULT: "var(--sidebar-accent)",
            foreground: "var(--sidebar-accent-foreground)",
          },
          ring: "var(--sidebar-ring)",
        },
        // Manchester Triage System — ver docs/07_design_system.md §2.2.
        // Paleta fija auditada WCAG AA. NO modificar por tenant.
        triage: {
          red: {
            DEFAULT: "var(--triage-red)",
            foreground: "var(--triage-red-foreground)",
          },
          orange: {
            DEFAULT: "var(--triage-orange)",
            foreground: "var(--triage-orange-foreground)",
          },
          yellow: {
            DEFAULT: "var(--triage-yellow)",
            foreground: "var(--triage-yellow-foreground)",
          },
          green: {
            DEFAULT: "var(--triage-green)",
            foreground: "var(--triage-green-foreground)",
          },
          blue: {
            DEFAULT: "var(--triage-blue)",
            foreground: "var(--triage-blue-foreground)",
          },
        },
      },
      borderRadius: {
        // Radios estandarizados v2.0 (Tarea 1). --radius = alias de md.
        sm:  "var(--radius-sm)",
        md:  "var(--radius-md)",
        lg:  "var(--radius-lg)",
        xl:  "var(--radius-xl)",
        // Retrocompat: Shadcn usa `rounded-lg` / `rounded-md` / `rounded-sm`
        // y espera `var(--radius)` o valores derivados. Redirigimos a los
        // nuevos tokens para consistencia sin romper componentes existentes.
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontFeatureSettings: {
        tabular: '"tnum"',
      },
      // Transiciones con tokens de movimiento v2.0 (Tarea 1).
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--motion-easing)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // Pulso sutil para alertas críticas (no spam, max 3 ciclos).
        "critical-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "critical-pulse": "critical-pulse 1.5s ease-in-out 3",
      },
    },
  },
  plugins: [animate, typography, containerQueries],
};

export default config;
