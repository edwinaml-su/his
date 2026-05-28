import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

/**
 * Tailwind config base del paquete `@his/ui` (HIS Multipaís).
 * Las apps (`apps/web`, `apps/mobile`) extienden este preset y añaden su propio `content`.
 *
 * - Colores semánticos: variables CSS HSL definidas en `globals.css` (light/dark).
 * - Triage Manchester: paleta fija (no tematizable por tenant — ver docs/07_design_system.md §2.2).
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
        // Tokens semánticos Shadcn (resueltos vía CSS variables HSL).
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Estados clínicos semánticos.
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        critical: {
          DEFAULT: "hsl(var(--critical))",
          foreground: "hsl(var(--critical-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        // Banners clínicos especiales (no colisionan con triage).
        lasa: {
          DEFAULT: "hsl(var(--lasa))",
          foreground: "hsl(var(--lasa-foreground))",
        },
        allergy: {
          DEFAULT: "hsl(var(--allergy))",
          foreground: "hsl(var(--allergy-foreground))",
        },
        // Sidebar — branding Avante navy. Tokens en globals.css con override
        // por tema. SIN este mapeo, las clases bg-sidebar-background, etc. no
        // se generan y el sidebar pierde el fondo navy → logo blanco invisible
        // en tema claro.
        sidebar: {
          background: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
          accent: {
            DEFAULT: "hsl(var(--sidebar-accent))",
            foreground: "hsl(var(--sidebar-accent-foreground))",
          },
          ring: "hsl(var(--ring))",
        },
        // Manchester Triage System — ver docs/07_design_system.md §2.2.
        // Paleta fija auditada WCAG AA. NO modificar por tenant.
        triage: {
          red: {
            DEFAULT: "hsl(var(--triage-red))",
            foreground: "hsl(var(--triage-red-foreground))",
          },
          orange: {
            DEFAULT: "hsl(var(--triage-orange))",
            foreground: "hsl(var(--triage-orange-foreground))",
          },
          yellow: {
            DEFAULT: "hsl(var(--triage-yellow))",
            foreground: "hsl(var(--triage-yellow-foreground))",
          },
          green: {
            DEFAULT: "hsl(var(--triage-green))",
            foreground: "hsl(var(--triage-green-foreground))",
          },
          blue: {
            DEFAULT: "hsl(var(--triage-blue))",
            foreground: "hsl(var(--triage-blue-foreground))",
          },
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
        // tabular-nums activado donde se aplique font-variant-numeric.
        tabular: '"tnum"',
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
  plugins: [animate, typography],
};

export default config;
