"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Bed,
  BedDouble,
  Stethoscope,
  ClipboardList,
  Building2,
  Settings,
  History,
  HeartPulse,
  Pill,
  FlaskConical,
  Activity,
  Scissors,
  Wind,
  Apple,
  Image as ImageIcon,
  ScanLine,
  Calendar,
  BellRing,
  Globe,
  Coins,
  MapPin,
  BookOpen,
  Wrench,
  ShieldCheck,
  Boxes,
  FileSignature,
  Skull,
  ShieldAlert,
  KeyRound,
  Gauge,
  BarChart3,
  Layers,
  ClipboardCheck,
  FileText,
  ChevronDown,
  ChevronRight,
  FilePenLine,
  BadgeCheck,
  GitBranch,
  Thermometer,
  NotebookPen,
  Siren,
  ArrowLeftRight,
  CheckSquare,
  UserCheck,
} from "lucide-react";
import { cn } from "@his/ui/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Si se especifica, el item solo aparece si el usuario tiene alguno de estos roles. */
  requiredRoles?: string[];
}

interface NavSection {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const SECTIONS: NavSection[] = [
  {
    label: "Visión",
    defaultOpen: true,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/analytics", label: "Analítica BI", icon: BarChart3 },
    ],
  },
  {
    label: "Clínico",
    defaultOpen: true,
    items: [
      { href: "/patients", label: "Pacientes", icon: Users },
      { href: "/admission", label: "Admisión", icon: ClipboardList },
      { href: "/beds", label: "Camas", icon: Bed },
      { href: "/census", label: "Censo", icon: Activity },
      { href: "/transfers", label: "Traslados", icon: Layers },
      { href: "/triage", label: "Triage", icon: Stethoscope },
      { href: "/emergency", label: "Emergencias", icon: HeartPulse },
      { href: "/outpatient", label: "Consulta externa", icon: Calendar },
      { href: "/ece/rectificaciones", label: "ECE Rectificaciones", icon: FilePenLine },
    ],
  },
  {
    label: "ECE — Atención",
    defaultOpen: true,
    items: [
      { href: "/ece/signos-vitales", label: "Signos Vitales", icon: Thermometer },
      {
        href: "/ece/indicaciones",
        label: "Indicaciones Médicas",
        icon: ClipboardCheck,
      },
      {
        href: "/ece/valoracion-inicial-enfermeria",
        label: "Valoración Inicial ENF",
        icon: NotebookPen,
      },
      {
        href: "/ece/registro-enfermeria",
        label: "Registro Enfermería",
        icon: ClipboardCheck,
      },
      { href: "/ece/evolucion", label: "Evolución Médica", icon: NotebookPen },
    ],
  },
  {
    label: "ECE — Quirófano",
    defaultOpen: true,
    items: [
      { href: "/surgery", label: "Quirófano", icon: Scissors },
      {
        href: "/ece/registro-anestesico",
        label: "Anestésico",
        icon: Wind,
      },
    ],
  },
  {
    label: "Diagnóstico",
    defaultOpen: true,
    items: [
      { href: "/ece/estudios", label: "Estudios ECE", icon: FlaskConical },
      { href: "/pharmacy", label: "Farmacia", icon: Pill },
      { href: "/emar", label: "eMAR", icon: ScanLine },
      { href: "/lis/results", label: "Laboratorio (LIS)", icon: FlaskConical },
      { href: "/imaging", label: "Imágenes (RIS)", icon: ImageIcon },
      { href: "/respiratory", label: "Respiratorio", icon: Wind },
      { href: "/nutrition", label: "Nutrición", icon: Apple },
    ],
  },
  {
    label: "ECE — Quirófano",
    defaultOpen: true,
    items: [
      { href: "/surgery", label: "Quirófano", icon: Scissors },
      { href: "/ece/quirofano/who-check", label: "WHO Checklist", icon: CheckSquare },
      { href: "/ece/urpa", label: "URPA", icon: UserCheck },
    ],
  },
  {
    label: "ECE — Hospitalario",
    defaultOpen: true,
    items: [
      { href: "/ece/hoja-ingreso", label: "Hoja de Ingreso", icon: ClipboardList },
      {
        href: "/ece/episodio-hospitalario",
        label: "Episodio Hospitalario",
        icon: BedDouble,
      },
    ],
  },
  {
    label: "ECE — Quirófano",
    defaultOpen: true,
    items: [
      { href: "/ece/quirofano/preop", label: "Preoperatorio", icon: ClipboardList },
    ],
  },
  {
    label: "ECE — Documentos",
    defaultOpen: true,
    items: [
      {
        href: "/ece/historia-clinica",
        label: "Historia Clínica",
        icon: FileText,
      },
      { href: "/ece/consentimiento", label: "Consentimientos médicos (NTEC)", icon: FileSignature },
      { href: "/ece/epicrisis", label: "Epicrisis", icon: ClipboardList },
      { href: "/ece/atencion-emergencia", label: "Atención Emergencia", icon: Siren },
      { href: "/ece/rri", label: "RRI", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Soporte clínico",
    defaultOpen: false,
    items: [
      { href: "/equipment", label: "Equipos médicos", icon: Wrench },
      { href: "/inventory", label: "Inventario", icon: Boxes },
      { href: "/insurance", label: "Aseguradoras", icon: ShieldCheck },
      { href: "/consents", label: "Consentimientos de datos (GDPR)", icon: FileSignature },
      { href: "/deaths", label: "Defunciones", icon: Skull },
      { href: "/ledgers", label: "Contabilidad", icon: BookOpen },
      { href: "/notifications", label: "Notificaciones", icon: BellRing },
    ],
  },
  {
    label: "Administración",
    defaultOpen: false,
    items: [
      { href: "/organizations", label: "Organizaciones", icon: Building2 },
      { href: "/users", label: "Usuarios", icon: Users },
      { href: "/roles", label: "Roles y permisos", icon: KeyRound },
      { href: "/abac", label: "Políticas ABAC", icon: ShieldAlert },
      { href: "/audit", label: "Auditoría", icon: History },
      { href: "/catalogs/gender", label: "Catálogos", icon: Settings },
      { href: "/countries", label: "Países", icon: Globe },
      { href: "/exchange-rates", label: "Tipos de cambio", icon: Coins },
      { href: "/sv-localization", label: "Localización SV", icon: MapPin },
      { href: "/triage-config", label: "Config. Triage", icon: Stethoscope },
      { href: "/sso-config", label: "SSO", icon: KeyRound },
      { href: "/slos", label: "SLOs", icon: Gauge },
      { href: "/settings/notifications", label: "Preferencias notif.", icon: Settings },
      { href: "/ece/bitacora", label: "Bitácora ECE", icon: ClipboardCheck },
      { href: "/ece/rectificaciones/cola", label: "ECE Cola DIR", icon: FilePenLine },
      {
        href: "/ece/certificacion",
        label: "Certificación DIR",
        icon: BadgeCheck,
        requiredRoles: ["DIR"],
      },
      { href: "/workflow-designer", label: "Workflow Designer", icon: GitBranch },
    ],
  },
];

function SectionGroup({
  section,
  pathname,
  roleCodes,
}: {
  section: NavSection;
  pathname: string | null;
  roleCodes: string[];
}) {
  const visibleItems = section.items.filter((item) =>
    !item.requiredRoles || item.requiredRoles.some((r) => roleCodes.includes(r)),
  );

  const [open, setOpen] = React.useState(section.defaultOpen ?? true);
  const sectionHasActive = visibleItems.some((i) => pathname?.startsWith(i.href));
  const expanded = open || sectionHasActive;

  if (visibleItems.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <span>{section.label}</span>
        {expanded ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <ul className="mt-0.5 space-y-0.5">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                      : "text-sidebar-foreground/90 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function AppShell({
  children,
  topbar,
  roleCodes = [],
}: {
  children: React.ReactNode;
  topbar?: React.ReactNode;
  /** Roles del usuario activo — usados para filtrar items con requiredRoles. */
  roleCodes?: string[];
}) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Saltar al contenido principal
      </a>
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground md:flex md:flex-col">
        <div className="border-b border-sidebar-border p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avante-logo.svg"
            alt="AVANTE Complejo Hospitalario"
            className="h-10 w-auto brightness-0 invert"
          />
          <p className="mt-2 text-xs uppercase tracking-wide opacity-70">
            Sistema de Información Hospitalaria · El Salvador
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Principal">
          {SECTIONS.map((section) => (
            <SectionGroup key={section.label} section={section} pathname={pathname} roleCodes={roleCodes} />
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-4 shadow-sm">
          <div className="text-sm text-muted-foreground">{topbar}</div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 bg-muted/30 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
