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
  HeartHandshake,
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
  Baby,
  Package,
  Truck,
  Undo2,
  Search,
  LayoutGrid,
  Zap,
  FileBadge,
  Paperclip,
  ClipboardPlus,
  TriangleAlert,
  Menu,
} from "lucide-react";
import { cn } from "@his/ui/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@his/ui/components/sheet";
import { Button } from "@his/ui/components/button";
import { Breadcrumbs } from "./breadcrumbs";

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
      { href: "/analytics/ejecutivo", label: "Dashboard Ejecutivo KPI", icon: Gauge },
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
      { href: "/ece/quirofano", label: "Dashboard Quirófano", icon: LayoutGrid },
      { href: "/surgery", label: "Quirófano", icon: Scissors },
      { href: "/ece/quirofano/preop", label: "Preoperatorio", icon: ClipboardList },
      { href: "/ece/quirofano/who-check", label: "WHO Checklist", icon: CheckSquare },
      { href: "/ece/quirofano/programacion", label: "Programación", icon: Scissors },
      { href: "/ece/quirofano/acto-quirurgico", label: "Acto Quirúrgico", icon: Zap },
      { href: "/ece/quirofano/consentimiento-qx", label: "Consentimiento Qx", icon: FileSignature },
      { href: "/ece/registro-anestesico", label: "Anestésico", icon: Wind },
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
      { href: "/ece/orden-ingreso", label: "Orden de Ingreso", icon: ClipboardPlus },
      { href: "/ece/certificado-incapacidad", label: "Certificado Incapacidad ISSS", icon: FileBadge },
      { href: "/ece/documento-asociado", label: "Documentos Asociados", icon: Paperclip },
      { href: "/ece/fall-event", label: "Reporte de Caídas (IPSG.6)", icon: TriangleAlert },
    ],
  },
  {
    label: "GS1 Logística",
    defaultOpen: false,
    items: [
      { href: "/gs1/inbound", label: "Inbound", icon: Package },
      { href: "/gs1/transfers", label: "Transfers", icon: Truck },
      { href: "/pharmacy/unidosis", label: "Unidosis", icon: Pill },
      { href: "/gs1/devoluciones", label: "Devoluciones", icon: Undo2 },
      { href: "/gs1/trazabilidad", label: "Trazabilidad", icon: Search },
      // F2-S7 — GS1 Bedside catálogos
      { href: "/gs1/gln", label: "GLN Jerarquía", icon: Layers },
      { href: "/gs1/medicamentos", label: "Medicamentos GS1", icon: Pill },
      { href: "/gs1/dashboard", label: "Dashboard GS1", icon: BarChart3 },
    ],
  },
  {
    label: "Bedside (BCMA)",
    defaultOpen: false,
    items: [
      { href: "/bedside", label: "Cola Bedside", icon: ScanLine },
      { href: "/pharmacy/dispense", label: "Dispensación Farmacia", icon: Pill },
      { href: "/pharmacy/cart", label: "Carrito Unidosis", icon: Boxes },
      { href: "/enfermeria/recepcion-farmacia", label: "Recepción Farmacia", icon: Truck },
      { href: "/patient-id", label: "ID Paciente (GSRN)", icon: ScanLine },
      { href: "/ece/kardex", label: "Kardex eMAR", icon: ClipboardCheck },
      { href: "/medico/substitutions-pending", label: "Sustituciones Pendientes", icon: ArrowLeftRight },
    ],
  },
  {
    label: "ECE — Maternidad",
    defaultOpen: true,
    items: [
      { href: "/ece/obstetricia", label: "Dashboard Maternidad", icon: LayoutGrid },
      { href: "/ece/obstetricia/expulsion", label: "Sala Expulsión", icon: BedDouble },
      { href: "/ece/obstetricia/partograma", label: "Partograma", icon: Activity },
      { href: "/ece/atencion-rn", label: "Atención RN", icon: Baby },
      { href: "/ece/reanimacion-neonatal", label: "Reanimación NRP", icon: HeartHandshake },
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
      // F2-S7 admin
      {
        href: "/staff-gsrn",
        label: "GSRN Personal",
        icon: BadgeCheck,
        requiredRoles: ["ADMIN_CLINICO", "ADMIN"],
      },
      {
        href: "/farmacovigilancia",
        label: "Farmacovigilancia",
        icon: ShieldAlert,
        requiredRoles: ["ADMIN", "PHARM", "DIRECTOR"],
      },
    ],
  },
];

function SectionGroup({
  section,
  pathname,
  roleCodes,
  collapsed = false,
}: {
  section: NavSection;
  pathname: string | null;
  roleCodes: string[];
  /** Si true, renderiza solo iconos (modo rail desktop). */
  collapsed?: boolean;
}) {
  const visibleItems = section.items.filter((item) =>
    !item.requiredRoles || item.requiredRoles.some((r) => roleCodes.includes(r)),
  );

  // ENFOQUE VISUAL: solo la sección que contiene el item activo arranca abierta.
  // Las demás están colapsadas para reducir ruido. El usuario puede expandirlas
  // manualmente y la elección persiste hasta que cambie de ruta.
  const sectionHasActive = visibleItems.some((i) => pathname?.startsWith(i.href));
  const [open, setOpen] = React.useState(sectionHasActive);

  // Si el usuario navega a otra sección, re-evaluamos: la nueva sección con
  // item activo se auto-expande; las demás vuelven a su estado por defecto
  // (cerradas) — pero si el usuario las había abierto manualmente, conservamos
  // esa elección sólo durante esa sesión de ruta. Compromiso pragmático:
  // forzamos a la sección activa a abrirse al cambiar de ruta.
  React.useEffect(() => {
    if (sectionHasActive) setOpen(true);
  }, [sectionHasActive]);

  if (visibleItems.length === 0) return null;

  // Modo rail (collapsed): renderiza solo los iconos directamente, sin
  // botón de sección. El title atributo sirve como tooltip nativo accesible.
  if (collapsed) {
    return (
      <ul className="mb-2 space-y-0.5 border-b border-sidebar-border/40 pb-2 last:border-0">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = pathname?.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={`${section.label} — ${item.label}`}
                aria-label={item.label}
                className={cn(
                  "flex h-10 items-center justify-center rounded-md transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <span>{section.label}</span>
        {open ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
      {open && (
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
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  // Estado collapse desktop (persiste en localStorage para sobrevivir refresh).
  // Hidratación diferida para evitar mismatch SSR.
  const [desktopCollapsed, setDesktopCollapsed] = React.useState(false);
  React.useEffect(() => {
    const stored = window.localStorage.getItem("his.sidebar.collapsed");
    if (stored === "true") setDesktopCollapsed(true);
  }, []);
  const toggleDesktopCollapse = React.useCallback(() => {
    setDesktopCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("his.sidebar.collapsed", String(next));
      return next;
    });
  }, []);

  // Cierra el drawer mobile al navegar (los items son <Link>; el cambio de
  // pathname implica que el usuario tocó uno).
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Nav body reutilizado entre sidebar desktop y sheet mobile.
  // `collapsed` solo aplica en desktop; mobile siempre renderiza expandido.
  const renderNavBody = (collapsed: boolean) => (
    <>
      <div className={cn(
        "border-b border-sidebar-border",
        collapsed ? "flex items-center justify-center p-2" : "p-4",
      )}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/avante-logo.svg"
          alt="AVANTE Complejo Hospitalario"
          className={cn(
            "w-auto brightness-0 invert",
            collapsed ? "h-7" : "h-10",
          )}
        />
        {!collapsed && (
          <p className="mt-2 text-xs uppercase tracking-wide opacity-70">
            Sistema de Información Hospitalaria · El Salvador
          </p>
        )}
      </div>
      <nav
        className={cn("flex-1 overflow-y-auto", collapsed ? "p-1.5" : "p-2")}
        aria-label="Principal"
      >
        {SECTIONS.map((section) => (
          <SectionGroup
            key={section.label}
            section={section}
            pathname={pathname}
            roleCodes={roleCodes}
            collapsed={collapsed}
          />
        ))}
      </nav>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Saltar al contenido principal
      </a>

      {/* Sidebar desktop (≥ md) — ancho condicional */}
      <aside
        className={cn(
          "hidden shrink-0 border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground transition-[width] duration-200 md:flex md:flex-col",
          desktopCollapsed ? "w-16" : "w-64",
        )}
      >
        {renderNavBody(desktopCollapsed)}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b bg-background px-2 shadow-sm sm:px-4">
          {/* Hamburguesa mobile (< md) abre Sheet */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 md:hidden"
                aria-label="Abrir menú de navegación"
              >
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-72 max-w-[85vw] flex-col border-r-sidebar-border bg-sidebar-background p-0 text-sidebar-foreground"
            >
              {renderNavBody(false)}
            </SheetContent>
          </Sheet>

          {/* Toggle desktop collapse (≥ md) */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden h-9 w-9 p-0 md:inline-flex"
            onClick={toggleDesktopCollapse}
            aria-label={desktopCollapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
            aria-pressed={desktopCollapsed}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </Button>

          <div className="min-w-0 flex-1 text-sm text-muted-foreground">{topbar}</div>
        </header>

        {/* Breadcrumbs (barra de navegabilidad) */}
        <Breadcrumbs pathname={pathname} />

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 bg-muted/30 p-3 sm:p-4 lg:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
