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
  Inbox,
  Menu,
  BriefcaseMedical,
  UserCog,
  Search as SearchIcon,
  X as XIcon,
} from "lucide-react";
import { cn } from "@his/ui/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@his/ui/components/sheet";
import { Button } from "@his/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@his/ui/components/tooltip";
import { Breadcrumbs } from "./breadcrumbs";
import { ChatWidget } from "./chat-widget";
import { isItemVisible } from "./nav-visibility";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Si se especifica, el item solo aparece si el usuario tiene alguno de estos roles. */
  requiredRoles?: string[];
  /**
   * Nivel A scope: si se especifica, el item solo aparece si el usuario
   * está asignado a alguno de estos `ServiceUnit.code`s. Los roles
   * cross-servicio (ADMIN/DIR/COO/etc.) bypassean este filtro.
   * `undefined` (default) = item visible para todos los roles permitidos
   * sin restricción de servicio.
   */
  requiredServiceUnits?: string[];
  /** Descripción corta para tooltip — explica qué hace la pantalla y a qué proceso pertenece. */
  description: string;
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
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard,
        description: "Pantalla de inicio. Resumen general de actividad del día y accesos rápidos." },
      { href: "/analytics", label: "Analítica BI", icon: BarChart3,
        description: "Reportes BI embebidos con KPIs operacionales y financieros." },
      { href: "/analytics/ejecutivo", label: "Dashboard Ejecutivo KPI", icon: Gauge,
        description: "Tablero ejecutivo con 36 KPIs en 7 categorías (clínicos, financieros, gobierno)." },
      { href: "/feedback", label: "Mi feedback (NPS)", icon: HeartHandshake,
        description: "Encuestas de satisfacción del personal (NPS) y comentarios." },
      { href: "/tareas", label: "Mi Bandeja (BPM)", icon: Inbox,
        description: "Bandeja centralizada de tareas pendientes según rol (BPM). 29 fuentes: recetas, NTEC, JCI, quirófano." },
    ],
  },
  {
    label: "Clínico",
    defaultOpen: true,
    items: [
      { href: "/patients", label: "Pacientes", icon: Users,
        description: "Registro maestro de pacientes (MPI). Búsqueda, alta, edición y deduplicación." },
      { href: "/admission", label: "Admisión", icon: ClipboardList,
        description: "Proceso de admisión: registra el ingreso del paciente al hospital." },
      { href: "/beds", label: "Camas", icon: Bed,
        description: "Mapa de camas por servicio. Asignación, libre/ocupado, limpieza." },
      { href: "/census", label: "Censo", icon: Activity,
        description: "Censo en tiempo real de pacientes hospitalizados por servicio." },
      { href: "/transfers", label: "Traslados", icon: Layers,
        description: "Traslados internos entre servicios y traslados externos a otros centros." },
      { href: "/triage", label: "Triage", icon: Stethoscope,
        requiredServiceUnits: ["ER"],
        description: "Triage Manchester en emergencias. Clasifica pacientes por urgencia (RED/ORANGE/YELLOW/GREEN/BLUE)." },
      { href: "/triage/monitor", label: "Monitor Triage", icon: Activity,
        requiredServiceUnits: ["ER"],
        description: "Wallboard kanban para TV: 5 columnas Manchester + sexo magenta/cian + paso del proceso." },
      { href: "/emergency", label: "Emergencias", icon: HeartPulse,
        requiredServiceUnits: ["ER"],
        description: "Atención de emergencia: visitas, motivos de consulta y desenlaces." },
      { href: "/outpatient", label: "Consulta externa", icon: Calendar,
        requiredServiceUnits: ["CE"],
        description: "Agendas y citas de consulta externa programada." },
      { href: "/ece/rectificaciones", label: "ECE Rectificaciones", icon: FilePenLine,
        description: "Solicitudes de rectificación de documentos ECE firmados (Art. 40 NTEC)." },
    ],
  },
  {
    label: "ECE — Atención",
    defaultOpen: true,
    items: [
      { href: "/ece/signos-vitales", label: "Signos Vitales", icon: Thermometer,
        description: "Captura y tendencias de signos vitales (PA, FC, FR, T°, SpO2, dolor)." },
      { href: "/ece/indicaciones", label: "Indicaciones Médicas", icon: ClipboardCheck,
        description: "Indicaciones médicas a personal de enfermería. Validación BCMA al ejecutar." },
      { href: "/ece/valoracion-inicial-enfermeria", label: "Valoración Inicial ENF", icon: NotebookPen,
        description: "Primera valoración de enfermería al ingreso del paciente (NTEC)." },
      { href: "/ece/registro-enfermeria", label: "Registro Enfermería", icon: ClipboardCheck,
        description: "Notas de enfermería por turno con plan de cuidados." },
      { href: "/ece/evolucion", label: "Evolución Médica", icon: NotebookPen,
        description: "Notas de evolución médica diarias durante la hospitalización." },
    ],
  },
  {
    label: "Diagnóstico",
    defaultOpen: true,
    items: [
      { href: "/ece/estudios", label: "Estudios ECE", icon: FlaskConical,
        description: "Solicitudes y resultados de estudios diagnósticos centralizados." },
      { href: "/pharmacy", label: "Farmacia", icon: Pill,
        requiredServiceUnits: ["FAR"],
        description: "Despacho de medicamentos. Validación de prescripción y stock." },
      { href: "/emar", label: "eMAR", icon: ScanLine,
        description: "Registro electrónico de administración de medicamentos (5 correctos + BCMA)." },
      { href: "/lis/results", label: "Laboratorio (LIS)", icon: FlaskConical,
        requiredServiceUnits: ["LAB"],
        description: "Resultados de laboratorio clínico, rangos de referencia y validación." },
      { href: "/imaging", label: "Imágenes (RIS)", icon: ImageIcon,
        requiredServiceUnits: ["RX"],
        description: "Estudios radiológicos: solicitudes, programación, reportes." },
      { href: "/respiratory", label: "Respiratorio", icon: Wind,
        description: "Terapia respiratoria: ventilación, nebulizaciones, oxigenoterapia." },
      { href: "/nutrition", label: "Nutrición", icon: Apple,
        description: "Plan nutricional enteral/parenteral y dietas hospitalarias." },
    ],
  },
  {
    label: "ECE — Quirófano",
    defaultOpen: true,
    items: [
      { href: "/ece/quirofano", label: "Dashboard Quirófano", icon: LayoutGrid,
        requiredServiceUnits: ["QX"],
        description: "Vista general de salas, casos del día y estado del proceso quirúrgico." },
      { href: "/surgery", label: "Quirófano", icon: Scissors,
        requiredServiceUnits: ["QX"],
        description: "Listado de casos quirúrgicos: pendientes, en curso, completados." },
      { href: "/ece/quirofano/preop", label: "Preoperatorio", icon: ClipboardList,
        requiredServiceUnits: ["QX"],
        description: "Valoración preoperatoria: riesgo anestésico, exámenes, ayuno." },
      { href: "/ece/quirofano/who-check", label: "WHO Checklist", icon: CheckSquare,
        requiredServiceUnits: ["QX"],
        description: "Lista de verificación OMS para cirugía segura (IPSG.4 JCI)." },
      { href: "/ece/quirofano/programacion", label: "Programación", icon: Scissors,
        requiredServiceUnits: ["QX"],
        description: "Programación de cirugías por sala, fecha y equipo médico." },
      { href: "/ece/quirofano/acto-quirurgico", label: "Acto Quirúrgico", icon: Zap,
        requiredServiceUnits: ["QX"],
        description: "Registro del acto quirúrgico: tiempos, equipo, hallazgos, procedimientos." },
      { href: "/ece/quirofano/consentimiento-qx", label: "Consentimiento Qx", icon: FileSignature,
        requiredServiceUnits: ["QX"],
        description: "Consentimiento informado para procedimiento quirúrgico (NTEC, doble firma)." },
      { href: "/ece/registro-anestesico", label: "Anestésico", icon: Wind,
        requiredServiceUnits: ["QX"],
        description: "Registro anestésico: medicamentos, ventilación, signos durante cirugía." },
      { href: "/ece/urpa", label: "URPA", icon: UserCheck,
        requiredServiceUnits: ["QX", "URPA"],
        description: "Unidad de Recuperación Post-Anestésica: monitoreo y criterios de egreso." },
    ],
  },
  {
    label: "ECE — Hospitalario",
    defaultOpen: true,
    items: [
      { href: "/ece/hoja-ingreso", label: "Hoja de Ingreso", icon: ClipboardList,
        description: "Documento NTEC de ingreso hospitalario con motivo, antecedentes y plan." },
      { href: "/ece/episodio-hospitalario", label: "Episodio Hospitalario", icon: BedDouble,
        description: "Vista unificada del episodio: documentos, órdenes, evolución y dependencias." },
    ],
  },
  {
    label: "ECE — Documentos",
    defaultOpen: true,
    items: [
      { href: "/ece/historia-clinica", label: "Historia Clínica", icon: FileText,
        description: "Historia clínica completa del paciente: anamnesis, antecedentes, exámenes." },
      { href: "/ece/consentimiento", label: "Consentimientos médicos (NTEC)", icon: FileSignature,
        description: "Consentimientos médicos informados según NTEC (HOSPITALIZACION, QUIRURGICO)." },
      { href: "/ece/epicrisis", label: "Epicrisis", icon: ClipboardList,
        description: "Resumen clínico al alta: diagnósticos, tratamiento, plan de seguimiento." },
      { href: "/ece/atencion-emergencia", label: "Atención Emergencia", icon: Siren,
        requiredServiceUnits: ["ER"],
        description: "Documento NTEC de atención en sala de emergencias." },
      { href: "/ece/rri", label: "RRI", icon: ArrowLeftRight,
        description: "Referencia, Retorno e Interconsulta entre servicios o centros." },
      { href: "/ece/orden-ingreso", label: "Orden de Ingreso", icon: ClipboardPlus,
        description: "Orden médica de ingreso hospitalario, formaliza la admisión." },
      { href: "/ece/certificado-incapacidad", label: "Certificado Incapacidad ISSS", icon: FileBadge,
        description: "Certificado de incapacidad para trabajadores cubiertos por ISSS." },
      { href: "/ece/documento-asociado", label: "Documentos Asociados", icon: Paperclip,
        description: "Documentos adjuntos al episodio (autorización, exámenes externos, etc.)." },
      { href: "/ece/fall-event", label: "Reporte de Caídas (IPSG.6)", icon: TriangleAlert,
        description: "Reporte de evento de caída del paciente. Cumple IPSG.6 JCI." },
    ],
  },
  {
    label: "GS1 Logística",
    defaultOpen: false,
    items: [
      { href: "/gs1/inbound", label: "Inbound", icon: Package,
        description: "Recepción de mercadería con códigos GS1 (GTIN, lote, vencimiento)." },
      { href: "/gs1/transfers", label: "Transfers", icon: Truck,
        description: "Movimientos de stock entre almacenes con trazabilidad GS1." },
      { href: "/pharmacy/unidosis", label: "Unidosis", icon: Pill,
        description: "Preparación de dosis unitarias por paciente para administración bedside." },
      { href: "/gs1/devoluciones", label: "Devoluciones", icon: Undo2,
        description: "Devoluciones de medicamentos no administrados con trazabilidad de lote." },
      { href: "/gs1/trazabilidad", label: "Trazabilidad", icon: Search,
        description: "Trazabilidad completa de lote: del proveedor al paciente (EPCIS)." },
      { href: "/gs1/gln", label: "GLN Jerarquía", icon: Layers,
        description: "Catálogo de localizaciones físicas con identificadores GLN GS1." },
      { href: "/gs1/medicamentos", label: "Medicamentos GS1", icon: Pill,
        description: "Maestro de medicamentos con códigos GTIN y mapeo NDC/CUM." },
      { href: "/gs1/dashboard", label: "Dashboard GS1", icon: BarChart3,
        description: "KPIs de adopción GS1: cobertura GTIN, escaneos, retiros de lote." },
    ],
  },
  {
    label: "Bedside (BCMA)",
    defaultOpen: false,
    items: [
      { href: "/bedside", label: "Cola Bedside", icon: ScanLine,
        description: "Cola de tareas pendientes en cabecera de paciente (medicación, signos)." },
      { href: "/pharmacy/dispense", label: "Dispensación Farmacia", icon: Pill,
        description: "Dispensación de medicamentos validada por GS1 antes de salir de farmacia." },
      { href: "/pharmacy/cart", label: "Carrito Unidosis", icon: Boxes,
        description: "Armado de carrito unidosis por turno para administración por enfermería." },
      { href: "/enfermeria/recepcion-farmacia", label: "Recepción Farmacia", icon: Truck,
        description: "Recepción y validación del carrito de farmacia en cada servicio." },
      { href: "/patient-id", label: "ID Paciente (GSRN)", icon: ScanLine,
        description: "Identificación del paciente vía brazalete GSRN GS1 (IPSG.1)." },
      { href: "/ece/kardex", label: "Kardex eMAR", icon: ClipboardCheck,
        description: "Kardex de medicación por paciente con historial de administraciones." },
      { href: "/medico/substitutions-pending", label: "Sustituciones Pendientes", icon: ArrowLeftRight,
        description: "Sustituciones farmacológicas pendientes de aprobación médica." },
    ],
  },
  {
    label: "ECE — Maternidad",
    defaultOpen: true,
    items: [
      { href: "/ece/obstetricia", label: "Dashboard Maternidad", icon: LayoutGrid,
        requiredServiceUnits: ["PARTOS", "GYN_OB"],
        description: "Tablero del servicio de obstetricia: trabajo de parto, expulsión, post-parto." },
      { href: "/ece/obstetricia/expulsion", label: "Sala Expulsión", icon: BedDouble,
        requiredServiceUnits: ["PARTOS", "GYN_OB"],
        description: "Sala de expulsión: progreso del parto, tipo de parto, complicaciones." },
      { href: "/ece/obstetricia/partograma", label: "Partograma", icon: Activity,
        requiredServiceUnits: ["PARTOS", "GYN_OB"],
        description: "Curva del trabajo de parto: dilatación, descenso, contracciones." },
      { href: "/ece/atencion-rn", label: "Atención RN", icon: Baby,
        requiredServiceUnits: ["PARTOS", "GYN_OB", "UCIN", "NEO"],
        description: "Atención inmediata del recién nacido: APGAR, antropometría, alta." },
      { href: "/ece/reanimacion-neonatal", label: "Reanimación NRP", icon: HeartHandshake,
        requiredServiceUnits: ["PARTOS", "GYN_OB", "UCIN", "NEO"],
        description: "Reanimación neonatal según protocolo NRP/AHA." },
    ],
  },
  {
    label: "Soporte clínico",
    defaultOpen: false,
    items: [
      { href: "/equipment", label: "Equipos médicos", icon: Wrench,
        description: "Inventario de equipos biomédicos con calibración y mantenimiento." },
      { href: "/inventory", label: "Inventario", icon: Boxes,
        description: "Inventario de insumos médicos y stock por bodega." },
      { href: "/insurance", label: "Aseguradoras", icon: ShieldCheck,
        description: "Catálogo de aseguradoras: pólizas, coberturas, deducibles." },
      { href: "/consents", label: "Consentimientos de datos (GDPR)", icon: FileSignature,
        description: "Consentimientos de tratamiento de datos personales (GDPR/LOPD)." },
      { href: "/deaths", label: "Defunciones", icon: Skull,
        description: "Registro de defunciones con CIE-10 y certificado de defunción." },
      { href: "/ledgers", label: "Contabilidad", icon: BookOpen,
        description: "Libros contables (FISCAL_SV / MANAGEMENT) y asientos." },
      { href: "/finance", label: "Resumen Financiero", icon: LayoutDashboard,
        description: "Landing del módulo finanzas: KPIs y accesos rápidos." },
      { href: "/finance/cost-centers", label: "Centros de Costo", icon: Building2,
        description: "41 centros de costo NTEC (productivos / intermedios / apoyo)." },
      { href: "/finance/price-lists", label: "Tarifario de Servicios", icon: BookOpen,
        description: "Tarifario de servicios clínicos. Auto-fill en facturación." },
      { href: "/finance/invoices", label: "Facturas", icon: FileText,
        description: "Emisión y consulta de facturas con imputación a centro de costo." },
      { href: "/finance/operating-costs", label: "Costos Operativos HIS", icon: Coins,
        description: "Costos operativos hospitalarios mensuales para prorrateo." },
      { href: "/finance/allocation-rules", label: "Reglas de Prorrateo", icon: GitBranch,
        description: "Configuración de reglas de prorrateo entre centros (suma = 100%)." },
      { href: "/finance/reportes", label: "Reportes Financieros", icon: BarChart3,
        description: "7 reportes regulatorios MINSAL: estado de resultados, costo por paciente, etc." },
      { href: "/notifications", label: "Notificaciones", icon: BellRing,
        description: "Centro de notificaciones del usuario: alertas y eventos del sistema." },
    ],
  },
  {
    label: "Administración",
    defaultOpen: false,
    items: [
      { href: "/organizations", label: "Organizaciones", icon: Building2,
        description: "Multi-tenancy: organizaciones y establecimientos del grupo Avante." },
      { href: "/users", label: "Usuarios", icon: Users,
        description: "Gestión de usuarios del sistema, membresías y estado." },
      { href: "/medicos", label: "Médicos", icon: BriefcaseMedical,
        description: "Catálogo B2B2C de médicos del complejo: cabecera, turno, especialistas, interconsultantes." },
      { href: "/profesionales-salud", label: "Profesionales de la Salud", icon: UserCog,
        description: "Personal no-médico: enfermería, archivo (ESDOMED), atención al cliente, administrativos." },
      { href: "/chat-analytics", label: "Asistente — Analytics", icon: BarChart3,
        description: "Telemetría del Avante Asistente: sesiones, preguntas frecuentes, satisfacción, costo." },
      { href: "/email-test", label: "Diagnóstico SMTP", icon: BellRing,
        requiredRoles: ["ADMIN", "DIRECTOR", "DIR"],
        description: "Prueba el envío de correos hacia Microsoft 365. Útil para validar configuración tras cambiar credenciales." },
      { href: "/odoo-introspect", label: "Introspección Odoo", icon: Layers,
        requiredRoles: ["ADMIN", "DIRECTOR", "DIR"],
        description: "Lee el esquema de res.partner en Odoo (READ-ONLY) para diseñar la réplica de campos del paciente en el HIS local." },
      { href: "/roles", label: "Roles y permisos", icon: KeyRound,
        description: "Catálogo de roles RBAC y permisos asignados por rol." },
      { href: "/asignaciones-servicio", label: "Asignaciones a servicio", icon: UserCog,
        requiredRoles: ["ADMIN", "DIR", "DIRECTOR", "MEDICAL_DIRECTOR"],
        description: "Nivel A — asigna usuarios a servicios (Emergencias, Quirófano, etc.). Filtra el menú y futuro data layer por servicio." },
      { href: "/abac", label: "Políticas ABAC", icon: ShieldAlert,
        description: "Políticas de control de acceso basadas en atributos." },
      { href: "/audit", label: "Auditoría", icon: History,
        description: "Bitácora de auditoría inmutable con hash chain (retención 10 años)." },
      { href: "/catalogs/gender", label: "Catálogos", icon: Settings,
        description: "Catálogos transversales: sexo biológico, género, estado civil, etc." },
      { href: "/countries", label: "Países", icon: Globe,
        description: "Configuración por país: validadores, identificadores, divisa." },
      { href: "/exchange-rates", label: "Tipos de cambio", icon: Coins,
        description: "Tipos de cambio históricos para conversión multi-moneda." },
      { href: "/sv-localization", label: "Localización SV", icon: MapPin,
        description: "Catálogos localizados El Salvador: departamentos, municipios, feriados." },
      { href: "/triage-config", label: "Config. Triage", icon: Stethoscope,
        description: "Configuración Manchester: niveles, flujogramas, discriminadores." },
      { href: "/sso-config", label: "SSO", icon: KeyRound,
        description: "Configuración de Single Sign-On (SAML / OIDC) para corporativos." },
      { href: "/slos", label: "SLOs", icon: Gauge,
        description: "Service Level Objectives: cumplimiento, error budgets." },
      { href: "/settings/notifications", label: "Preferencias notif.", icon: Settings,
        description: "Preferencias de notificación por usuario (email, push, in-app)." },
      { href: "/ece/bitacora", label: "Bitácora ECE", icon: ClipboardCheck,
        description: "Bitácora de eventos ECE (creación, firma, validación de documentos)." },
      { href: "/ece/rectificaciones/cola", label: "ECE Cola DIR", icon: FilePenLine,
        description: "Cola de rectificaciones ECE pendientes de aprobación DIR." },
      { href: "/ece/certificacion", label: "Certificación DIR", icon: BadgeCheck,
        requiredRoles: ["DIR"],
        description: "Certificación de documentos ECE por Director (Art. NTEC)." },
      { href: "/workflow-designer", label: "Workflow Designer", icon: GitBranch,
        description: "Diseñador WYSIWYG de workflows ECE: estados, transiciones, dependencias." },
      { href: "/staff-gsrn", label: "GSRN Personal", icon: BadgeCheck,
        requiredRoles: ["ADMIN_CLINICO", "ADMIN"],
        description: "Asignación de GSRN GS1 al personal clínico." },
      { href: "/farmacovigilancia", label: "Farmacovigilancia", icon: ShieldAlert,
        requiredRoles: ["ADMIN", "PHARM", "DIRECTOR"],
        description: "Reportes de reacciones adversas medicamentosas (RAM)." },
    ],
  },
];

/** Input de búsqueda del menú. Filtra items por label/description. ESC limpia. */
function SidebarSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative mb-2">
      <SearchIcon
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/50"
        aria-hidden="true"
      />
      <input
        type="search"
        role="searchbox"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder="Buscar en el menú…"
        aria-label="Buscar en el menú"
        className={cn(
          "w-full rounded-md border border-sidebar-border bg-sidebar-background",
          "py-1.5 pl-8 pr-7 text-sm text-sidebar-foreground",
          "placeholder:text-sidebar-foreground/50",
          "focus:outline-none focus:ring-2 focus:ring-sidebar-ring focus:border-transparent",
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpiar búsqueda"
          className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Estado vacío global del menú cuando ninguna sección tiene matches. */
function SidebarNoResults({
  query,
  sections,
  roleCodes,
  assignedServiceUnitCodes,
  isCrossServiceRole,
}: {
  query: string;
  sections: NavSection[];
  roleCodes: string[];
  assignedServiceUnitCodes: string[];
  isCrossServiceRole: boolean;
}) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  // Verifica si CUALQUIER sección tiene al menos un match (label o description)
  // considerando los filtros de rol + servicio. Si hay matches, no mostramos
  // este bloque (cada SectionGroup mostrará lo suyo).
  const hasAnyMatch = sections.some((s) =>
    s.items.some(
      (i) =>
        isItemVisible(i, roleCodes, assignedServiceUnitCodes, isCrossServiceRole) &&
        (i.label.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q)),
    ),
  );
  if (hasAnyMatch) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 rounded-md border border-dashed border-sidebar-border/60 px-3 py-3 text-center text-xs text-sidebar-foreground/70"
    >
      Sin resultados para <span className="font-semibold">&ldquo;{query}&rdquo;</span>
    </div>
  );
}

function SectionGroup({
  section,
  pathname,
  roleCodes,
  assignedServiceUnitCodes,
  isCrossServiceRole,
  collapsed = false,
  searchQuery = "",
}: {
  section: NavSection;
  pathname: string | null;
  roleCodes: string[];
  /** Nivel A — codes de los servicios a los que el usuario está asignado. */
  assignedServiceUnitCodes: string[];
  /** Bypass del filtro de servicio para ADMIN/DIR/COO/etc. */
  isCrossServiceRole: boolean;
  /** Si true, renderiza solo iconos (modo rail desktop). */
  collapsed?: boolean;
  /** Filtra items por label / description (case-insensitive). */
  searchQuery?: string;
}) {
  const visibleItems = section.items.filter((item) =>
    isItemVisible(item, roleCodes, assignedServiceUnitCodes, isCrossServiceRole),
  );

  // Filtrado por búsqueda — case-insensitive sobre label y description.
  const q = searchQuery.trim().toLowerCase();
  const filteredItems = q
    ? visibleItems.filter(
        (i) =>
          i.label.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q),
      )
    : visibleItems;

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

  // Cuando hay búsqueda activa con resultados, forzamos la sección abierta
  // para que el usuario vea los matches sin tener que expandir manualmente.
  const effectiveOpen = q ? filteredItems.length > 0 : open;

  // Sin items tras filtros (rol + búsqueda) → no renderizar la sección.
  if (filteredItems.length === 0) return null;

  // Modo rail (collapsed): renderiza solo los iconos directamente, sin
  // botón de sección. Tooltip Radix con label + descripción a la derecha.
  if (collapsed) {
    return (
      <ul className="mb-2 space-y-0.5 border-b border-sidebar-border/40 pb-2 last:border-0">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const active = pathname?.startsWith(item.href);
          return (
            <li key={item.href}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    aria-label={`${item.label} — ${item.description}`}
                    className={cn(
                      "flex h-10 items-center justify-center rounded-md transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" align="center" className="max-w-xs">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    {section.label}
                  </div>
                  <div className="font-semibold">{item.label}</div>
                  <div className="mt-0.5 text-xs leading-snug text-popover-foreground/80">
                    {item.description}
                  </div>
                </TooltipContent>
              </Tooltip>
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
        aria-expanded={effectiveOpen}
        disabled={!!q}
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-100 disabled:cursor-default"
      >
        <span>{section.label}</span>
        {effectiveOpen ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
      {effectiveOpen && (
        <ul className="mt-0.5 space-y-0.5">
          {filteredItems.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);
            return (
              <li key={item.href}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      aria-label={`${item.label} — ${item.description}`}
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
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center" className="max-w-xs">
                    <div className="font-semibold">{item.label}</div>
                    <div className="mt-0.5 text-xs leading-snug text-popover-foreground/80">
                      {item.description}
                    </div>
                  </TooltipContent>
                </Tooltip>
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
  assignedServiceUnitCodes = [],
  isCrossServiceRole = false,
  chatAuth,
}: {
  children: React.ReactNode;
  topbar?: React.ReactNode;
  /** Roles del usuario activo — usados para filtrar items con requiredRoles. */
  roleCodes?: string[];
  /**
   * Nivel A — `code`s de los `ServiceUnit` a los que el usuario está asignado.
   * Default `[]` = sin restricción (backward compat). Items con
   * `requiredServiceUnits` se ocultan si NO hay intersección y el usuario
   * tampoco es cross-service.
   */
  assignedServiceUnitCodes?: string[];
  /**
   * `true` si el usuario tiene rol cross-servicio (ADMIN, DIR, COO, CFO,
   * CEO, MEDICAL_DIRECTOR, AUDITOR). Bypassea el filtro de servicio.
   */
  isCrossServiceRole?: boolean;
  /** Identidad del usuario para tools tenant-scoped del chatbot. */
  chatAuth?: { userId: string; organizationId?: string };
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  /** Búsqueda en el menú lateral — filtra items por label / description. */
  const [searchQuery, setSearchQuery] = React.useState("");

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

  // Cierra el drawer mobile + limpia la búsqueda al navegar (los items son
  // <Link>; el cambio de pathname implica que el usuario tocó uno).
  React.useEffect(() => {
    setMobileNavOpen(false);
    setSearchQuery("");
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
        {/* Buscador del menú — solo en modo expandido. Filtra items por
            label / description. Forza apertura de las secciones con matches. */}
        {!collapsed && (
          <SidebarSearch
            value={searchQuery}
            onChange={setSearchQuery}
          />
        )}
        {SECTIONS.map((section) => (
          <SectionGroup
            key={section.label}
            section={section}
            pathname={pathname}
            roleCodes={roleCodes}
            assignedServiceUnitCodes={assignedServiceUnitCodes}
            isCrossServiceRole={isCrossServiceRole}
            collapsed={collapsed}
            searchQuery={collapsed ? "" : searchQuery}
          />
        ))}
        {/* Estado vacío global cuando hay query sin matches en ninguna sección. */}
        {!collapsed && searchQuery.trim() && (
          <SidebarNoResults
            query={searchQuery}
            sections={SECTIONS}
            roleCodes={roleCodes}
            assignedServiceUnitCodes={assignedServiceUnitCodes}
            isCrossServiceRole={isCrossServiceRole}
          />
        )}
      </nav>
    </>
  );

  return (
    // delayDuration corto: 200ms para tooltips aparezcan rápido al pasar el
    // cursor por items del sidebar. skipDelayDuration default permite que al
    // mover entre items vecinos el tooltip cambie sin re-esperar el delay.
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
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
      {/* Asistente HIS — copiloto flotante context-aware. */}
      <ChatWidget roleCodes={roleCodes} chatAuth={chatAuth} />
    </TooltipProvider>
  );
}
