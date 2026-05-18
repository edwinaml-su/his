"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Bed,
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
  ArrowRightLeft,
  ScanLine,
} from "lucide-react";
import { cn } from "@his/ui/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
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
      {
        href: "/medico/substitutions-pending",
        label: "Sustituciones pendientes",
        icon: ArrowRightLeft,
        requiredRoles: ["MEDICO", "ADMIN"],
      },
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
      { href: "/enfermeria/recepcion-farmacia", label: "Recepción Farmacia", icon: Boxes },
      { href: "/bedside", label: "Bedside (Enfermería)", icon: ScanLine },
      { href: "/ece/kardex", label: "Kardex", icon: ClipboardCheck },
    ],
  },
  {
    label: "Diagnóstico",
    defaultOpen: true,
    items: [
      { href: "/ece/estudios", label: "Estudios ECE", icon: FlaskConical },
      { href: "/pharmacy", label: "Farmacia", icon: Pill },
      { href: "/pharmacy/dispense", label: "Picking Dispensación", icon: ClipboardCheck },
      { href: "/pharmacy/cart", label: "Carrito Unidosis", icon: Boxes },
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
    label: "GS1 Logística",
    defaultOpen: false,
    items: [
      { href: "/gs1/gln",          label: "GLN Ubicaciones",    icon: MapPin },
      { href: "/gs1/medicamentos", label: "Medicamentos GTIN",  icon: Pill },
      { href: "/gs1/dashboard",    label: "Dashboard GS1",      icon: LayoutGrid },
      { href: "/gs1/lote",         label: "Trazabilidad lote",  icon: Boxes },
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
      // F2-S7 US.F2.6.2
      {
        href: "/staff-gsrn",
        label: "GSRN Personal",
        icon: BadgeCheck,
        requiredRoles: ["ADMIN_CLINICO", "ADMIN"],
      // Fase 2 S7 — Farmacovigilancia (US.F2.6.56)
      {
        href: "/farmacovigilancia",
        label: "Farmacovigilancia",
        icon: ShieldAlert,
        requiredRoles: ["ADMIN", "PHARM", "DIRECTOR"],
      },
    ],
  },
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patients", label: "Pacientes", icon: Users },
  { href: "/admission", label: "Admisión", icon: ClipboardList },
  { href: "/beds", label: "Camas", icon: Bed },
  { href: "/triage", label: "Triage", icon: Stethoscope },
  // US.F2.6.37-40 — Identificación de paciente por pulsera GSRN
  { href: "/patient-id", label: "Identificación Paciente", icon: ScanLine },
  { href: "/organizations", label: "Organizaciones", icon: Building2 },
  { href: "/users", label: "Usuarios", icon: Users },
  { href: "/audit", label: "Auditoría", icon: History },
  { href: "/catalogs/gender", label: "Catálogos", icon: Settings },
];

export function AppShell({
  children,
  topbar,
}: {
  children: React.ReactNode;
  topbar?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar-background md:flex md:flex-col">
        <div className="border-b p-4">
          <p className="text-base font-bold">HIS Avante</p>
          <p className="text-xs text-muted-foreground">El Salvador</p>
        </div>
        <nav className="flex-1 space-y-1 p-2" aria-label="Principal">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-4">
          <div className="text-sm text-muted-foreground">{topbar}</div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
