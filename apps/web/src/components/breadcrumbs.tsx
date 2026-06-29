"use client";

/**
 * Breadcrumbs — barra de navegabilidad tipo "migajas de pan" debajo del header.
 *
 * Reconstruye la ruta visual a partir de `pathname`:
 *   /ece/atencion-emergencia/nuevo     → Inicio › ECE › Atención Emergencia › Nuevo
 *   /admin/users/depuracion            → Inicio › Administración › Usuarios › Depuración
 *   /ece/episodio-hospitalario/[uuid]  → Inicio › ECE › Episodio Hospitalario › …
 *
 * Reglas de mapeo:
 *   - Top-level slugs (admin, ece, gs1, …) → label custom.
 *   - Segundo nivel: lookup en SLUG_LABELS; fallback a Title Case del slug.
 *   - UUIDs y números: se renderizan como "…" (no aportan navegabilidad).
 *
 * Cada nivel intermedio es un Link clickable; el último es texto plano.
 * Se oculta automáticamente en la raíz de cada sección de top-level.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Slugs especiales con label custom. El resto cae a title-case. */
const SLUG_LABELS: Record<string, string> = {
  // Top-level
  admin:                    "Administración",
  ece:                      "ECE",
  gs1:                      "GS1 Logística",
  pharmacy:                 "Farmacia",
  triage:                   "Triaje",
  consents:                 "Consentimientos",
  deaths:                   "Defunciones",

  // ECE — documentos
  "atencion-emergencia":    "Atención Emergencia",
  "atencion-rn":            "Atención RN",
  "certificado-incapacidad":"Cert. Incapacidad",
  "documento-asociado":     "Doc. Asociados",
  "episodio-hospitalario":  "Cuenta Hospitalaria",
  "evolucion":              "Evolución Médica",
  "fall-event":             "Reporte de Caídas",
  "historia-clinica":       "Historia Clínica",
  "hoja-ingreso":           "Hoja de Ingreso",
  "indicaciones":           "Indicaciones Médicas",
  "orden-ingreso":          "Orden de Ingreso",
  "reanimacion-neonatal":   "Reanimación Neonatal",
  "registro-anestesico":    "Registro Anestésico",
  "registro-enfermeria":    "Registro Enfermería",
  "registro-retroactivo":   "Registro Retroactivo",
  "rectificaciones":        "Rectificaciones",
  "rectificacion":          "Rectificación",
  "rri":                    "RRI",
  "signos-vitales":         "Signos Vitales",
  "urpa":                   "URPA",
  "valoracion-inicial-enfermeria": "Val. Inicial Enfermería",
  "estudios":               "Estudios",
  "icd10-picker":           "CIE-10",
  "epicrisis":              "Epicrisis",
  "defuncion":              "Defunción",
  "obstetricia":            "Obstetricia",
  "quirofano":              "Quirófano",
  "kardex":                 "Kardex",
  "camas":                  "Camas",

  // Admin
  "workflow-designer":      "Workflow Designer",
  "workflow-overrides":     "Overrides DIR",
  "stat-events":            "Statistical Events",
  "merge-queue":            "Cola de fusión",
  "rbac":                   "RBAC",
  "matriz":                 "Matriz",
  "users":                  "Usuarios",
  "depuracion":             "Depuración",
  "ledgers":                "Libros contables",

  // Acciones comunes
  "nuevo":                  "Nuevo",
  "editar":                 "Editar",
};

/**
 * Overrides por ruta completa (href acumulado), no por slug.
 * Necesario cuando un mismo slug ("new") aparece en muchas rutas pero solo
 * en una debe rotularse distinto (p. ej. /patients/new = "Pre-registro", CC-0008).
 */
const PATH_LABELS: Record<string, string> = {
  "/patients": "Pacientes",
  "/patients/new": "Pre-registro",
};

function labelFor(slug: string): string {
  if (UUID_RE.test(slug)) return "…";
  if (/^\d+$/.test(slug)) return "…";
  const custom = SLUG_LABELS[slug];
  if (custom) return custom;
  // Title case del slug: "valoracion-inicial" → "Valoracion Inicial".
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function Breadcrumbs({ pathname }: { pathname: string | null }) {
  if (!pathname) return null;
  const segments = pathname.split("/").filter(Boolean);
  // En la raíz no muestra nada (evita "Inicio" solo).
  if (segments.length === 0) return null;

  // Reconstruye href acumulado por nivel.
  const items = segments.map((slug, idx) => {
    const href = "/" + segments.slice(0, idx + 1).join("/");
    return { href, label: PATH_LABELS[href] ?? labelFor(slug) };
  });

  return (
    <nav
      aria-label="Migas de pan"
      className="border-b bg-background/60 px-3 py-2 text-xs sm:px-4 sm:text-sm"
    >
      <ol className="flex flex-wrap items-center gap-1 text-muted-foreground">
        <li>
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded hover:text-foreground"
            aria-label="Inicio"
          >
            <Home className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </li>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <React.Fragment key={item.href}>
              <li aria-hidden className="opacity-60">
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li>
                {isLast ? (
                  <span className="font-medium text-foreground" aria-current="page">
                    {item.label}
                  </span>
                ) : (
                  <Link href={item.href} className="rounded hover:text-foreground">
                    {item.label}
                  </Link>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
