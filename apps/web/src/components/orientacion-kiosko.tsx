"use client";

/**
 * Orientación táctil — wayfinding para tablets / kioskos de admisión.
 *
 * Vista ADITIVA del HIS: navegación guiada por pasos que categoriza al paciente
 * (árbol derivado del mermaid Servicios_HIS_Principal) y deriva a la pantalla
 * ya existente del HIS.
 *
 * Modos (`montaje`):
 *   - "embebido": renderiza solo el flujo (migas + cuerpo). Úsalo dentro del
 *     AppShell — el sidebar y header del HIS los provee el layout. (DEFAULT)
 *   - "kiosko":   pantalla completa con su propio encabezado, para la tablet/
 *     kiosko físico montado SIN AppShell.
 *
 * Todos los parámetros aceptan prop o ?query (montaje, estilo, device, baseUrl,
 * mostrarRutas, triageDestacado), por lo que se puede alternar sin recompilar.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2, Footprints, Siren, CalendarCheck, Stethoscope, Scissors, Droplet,
  FlaskConical, ScanLine, Activity, ClipboardList, ArrowRight, ArrowUpRight,
  ChevronRight, ChevronLeft, Home, Check, Clock, Menu, type LucideIcon,
} from "lucide-react";

/* ────────────────────────────── Tipos ────────────────────────────── */
type Estilo = "claro" | "inmersivo" | "senaletica";
type Device = "tablet" | "kiosk";
type Montaje = "embebido" | "kiosko";

interface DestKey { deskCode: string; deskName: string; screen: string; section: string; route: string; icon: LucideIcon; extra?: { label: string; route: string }[]; }
interface Node {
  id: string; title: string; accent?: string; icon?: LucideIcon;
  subtitle?: string; cta?: string; question?: string; kicker?: string;
  children?: Node[]; triage?: boolean; dest?: keyof typeof DEST;
}

export interface OrientacionKioskoProps {
  montaje?: Montaje;
  estilo?: Estilo;
  device?: Device;
  baseUrl?: string;
  mostrarRutas?: boolean;
  triageDestacado?: boolean;
}

/* ───────────────────── Destinos = pantallas del HIS ───────────────────── */
const DEST = {
  emerg:   { deskCode: "05", deskName: "Admisión de emergencias", screen: "Emergencias", section: "Clínico", route: "/emergency", icon: Siren,
             extra: [ { label: "Triage Manchester", route: "/triage" }, { label: "Monitor Triage", route: "/triage/monitor" } ] },
  lab:     { deskCode: "02", deskName: "Admisión de laboratorio", screen: "Laboratorio (LIS)", section: "Diagnóstico", route: "/lis/results", icon: FlaskConical },
  clin:    { deskCode: "03", deskName: "Admisión de clínicas", screen: "Consulta externa", section: "Clínico", route: "/outpatient", icon: CalendarCheck },
  central: { deskCode: "04", deskName: "Admisión central", screen: "Admisión", section: "Clínico", route: "/admission", icon: ClipboardList },
  citas:   { deskCode: "01", deskName: "Admisión de citas y procedimiento", screen: "Admisión", section: "Clínico", route: "/admission", icon: ClipboardList },
  imaging: { deskCode: "01", deskName: "Admisión de citas y procedimiento", screen: "Imágenes (RIS/PACS)", section: "Diagnóstico", route: "/imaging", icon: ScanLine },
  surgery: { deskCode: "04", deskName: "Admisión central", screen: "Quirófano", section: "ECE — Quirófano", route: "/surgery", icon: Scissors },
} satisfies Record<string, DestKey>;

/* ─────────── Triage Manchester — hex PROTEGIDOS (WCAG 2.1 AA) ─────────── */
const TRIAGE = [
  { id: "t-red",    code: "1", label: "Rojo",     hex: "#DC2626", fg: "#fff",     dark: false, care: "Máxima urgencia",            target: "Atención inmediata" },
  { id: "t-orange", code: "2", label: "Naranja",  hex: "#EA580C", fg: "#fff",     dark: false, care: "Consultorio de emergencias", target: "≤ 10 min" },
  { id: "t-yellow", code: "3", label: "Amarillo", hex: "#CA8A04", fg: "#1a1505", dark: true,  care: "Consultorio de urgencias",   target: "≤ 60 min" },
  { id: "t-green",  code: "4", label: "Verde",    hex: "#16A34A", fg: "#fff",     dark: false, care: "Essential Care",             target: "≤ 120 min" },
  { id: "t-blue",   code: "5", label: "Azul",     hex: "#2563EB", fg: "#fff",     dark: false, care: "Essential Care",             target: "≤ 240 min" },
] as const;
const TRIAGE_DEST: keyof typeof DEST = "emerg";

/* ───────────────── Árbol de decisión (deriva del mermaid) ───────────────── */
const NAVY = "#1F2145", BLUE = "#174281", BRIGHT = "#0975BA", RED = "#DC2626",
  TEAL = "#0f766e", VIO = "#6d28d9", AMBER = "#b45309", CYAN = "#0e7490", PINK = "#9d174d", GREEN = "#15803d";

const TREE: Node = {
  id: "root", title: "Servicios",
  question: "¿Qué tipo de atención necesita el paciente?", kicker: "Pre-Registro · Paso 1",
  children: [
    { id: "hosp", title: "Hospitalario", accent: NAVY, icon: Building2,
      subtitle: "Ingreso a hospitalización, urgencias o cirugía.", cta: "Continuar",
      question: "¿Por qué vía ingresa el paciente?", kicker: "Hospitalario · Paso 2",
      children: [
        { id: "urg", title: "Urgencias y emergencias", accent: RED, icon: Siren,
          subtitle: "Atención no programada. Requiere clasificación de triage.", cta: "Clasificar triage",
          question: "Clasifique al paciente — Triage Manchester", kicker: "Triage · Paso 3", triage: true },
        { id: "elec", title: "Ingreso electivo", accent: BLUE, icon: CalendarCheck,
          subtitle: "Hospitalización programada con orden de ingreso.", cta: "Continuar",
          question: "Seleccione el destino del ingreso", kicker: "Ingreso electivo · Paso 3",
          children: [
            { id: "manejo", title: "Manejo médico", accent: TEAL, icon: Stethoscope, subtitle: "Tratamiento clínico hospitalario sin cirugía.", cta: "Derivar", dest: "central" },
            { id: "quir", title: "Procedimiento quirúrgico", accent: VIO, icon: Scissors, subtitle: "Ingreso para intervención en quirófano.", cta: "Derivar", dest: "surgery" },
          ] },
      ] },
    { id: "amb", title: "Ambulatorio", accent: BRIGHT, icon: Footprints,
      subtitle: "Atención sin hospitalización: estudios, consultas y procedimientos.", cta: "Continuar",
      question: "Seleccione el servicio ambulatorio", kicker: "Ambulatorio · Paso 2",
      children: [
        { id: "banco", title: "Banco de sangre", accent: PINK, icon: Droplet, subtitle: "Donación, pruebas cruzadas y transfusión.", cta: "Derivar", dest: "citas" },
        { id: "lab", title: "Laboratorio clínico (LIS)", accent: GREEN, icon: FlaskConical, subtitle: "Toma de muestras y estudios de laboratorio.", cta: "Derivar", dest: "lab" },
        { id: "rad", title: "Radiología e imágenes", accent: CYAN, icon: ScanLine, subtitle: "RIS / PACS — rayos X, ultrasonido, tomografía, resonancia.", cta: "Derivar", dest: "imaging" },
        { id: "clin", title: "Clínicas especializadas", accent: BLUE, icon: Stethoscope, subtitle: "Consulta externa por especialidad.", cta: "Derivar", dest: "clin" },
        { id: "proc", title: "Procedimientos", accent: AMBER, icon: Activity, subtitle: "Procedimientos ambulatorios diagnósticos o terapéuticos.", cta: "Derivar", dest: "citas" },
        { id: "cira", title: "Cirugía ambulatoria", accent: VIO, icon: Scissors, subtitle: "Cirugía sin pernocta — unidad de cirugía ambulatoria.", cta: "Derivar", dest: "surgery" },
      ] },
  ],
};

/* ─────────────────────────────── Utils ─────────────────────────────── */
function alpha(hex: string, a: number) {
  const h = hex.replace("#", ""); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function mix(hex: string, to: string, t: number) {
  const h = hex.replace("#", ""), H = to.replace("#", "");
  const c = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - t) + parseInt(H.slice(i, i + 2), 16) * t);
  return "#" + [c(0), c(2), c(4)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function childrenOf(n: Node): Node[] { return n.children || (n.triage ? (TRIAGE as readonly any[]).map((tr) => ({ id: tr.id, title: tr.label, dest: TRIAGE_DEST })) : []); }
function nodeAt(path: string[]): { node: Node; triageId?: string } {
  let n: Node = TREE; let triageId: string | undefined;
  for (const id of path) {
    if (n.triage) { triageId = id; const t = TRIAGE.find((x) => x.id === id); if (t) return { node: { id: t.id, title: t.label, dest: TRIAGE_DEST }, triageId: id }; }
    const next = childrenOf(n).find((c) => c.id === id); if (!next) break; n = next;
  }
  return { node: n, triageId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const THEMES: Record<Estilo, any> = {
  claro: { backdrop: "#e7ebf1", panelBg: "#f5f7fa", text: "#161a36", muted: "#5a6178", headerBg: "#1F2145", headerText: "#fff", headerBorder: "rgba(255,255,255,.08)", markBg: "rgba(255,255,255,.12)", markStroke: "#7cc4ff", headChip: "rgba(255,255,255,.10)", headBtn: "rgba(255,255,255,.14)", railBg: "#eef1f6", cardBg: "#fff", cardBorder: "#e2e7ef", cardText: "#161a36", accent: "#174281", accentText: "#fff", accentShadow: "rgba(23,66,129,.55)", routeBg: "#f1f4f9", routeBorder: "#c9d3e2" },
  inmersivo: { backdrop: "#0c0f26", panelBg: "linear-gradient(160deg,#23264f,#181b3c 55%,#141733)", text: "#eef1fb", muted: "#9aa3c7", headerBg: "rgba(255,255,255,.04)", headerText: "#fff", headerBorder: "rgba(255,255,255,.10)", markBg: "rgba(124,196,255,.16)", markStroke: "#7cc4ff", headChip: "rgba(255,255,255,.08)", headBtn: "rgba(255,255,255,.12)", railBg: "rgba(255,255,255,.03)", cardBg: "rgba(255,255,255,.055)", cardBorder: "rgba(255,255,255,.13)", cardText: "#f3f5ff", accent: "#0975BA", accentText: "#fff", accentShadow: "rgba(9,117,186,.6)", routeBg: "rgba(255,255,255,.05)", routeBorder: "rgba(255,255,255,.22)" },
  senaletica: { backdrop: "#dfe3ea", panelBg: "#fff", text: "#10142e", muted: "#646b80", headerBg: "#174281", headerText: "#fff", headerBorder: "rgba(255,255,255,.10)", markBg: "rgba(255,255,255,.16)", markStroke: "#fff", headChip: "rgba(255,255,255,.14)", headBtn: "rgba(255,255,255,.18)", railBg: "#f4f6fa", cardBg: "#fff", cardBorder: "#10142e", cardText: "#10142e", accent: "#D21D2B", accentText: "#fff", accentShadow: "rgba(210,29,43,.5)", routeBg: "#f4f6fa", routeBorder: "#10142e" },
};

/* ───────────────────────────── Componente ───────────────────────────── */
export function OrientacionKiosko(props: OrientacionKioskoProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const cfg = <T,>(name: keyof OrientacionKioskoProps, fallback: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = props[name] as any; if (p != null && p !== "") return p as T;
    const q = sp?.get(name as string); if (q != null && q !== "") return q as unknown as T;
    return fallback;
  };

  const montaje = cfg<Montaje>("montaje", "embebido");
  const estilo = cfg<Estilo>("estilo", "claro");
  const device = cfg<Device>("device", "tablet");
  const baseUrl = String(cfg("baseUrl", "")).replace(/\/+$/, "");
  const mostrarRutas = String(cfg("mostrarRutas", true)) !== "false";
  const destacado = String(cfg("triageDestacado", true)) !== "false";

  const t = THEMES[estilo] ?? THEMES.claro;
  const dark = estilo === "inmersivo";
  const kioskUI = montaje === "kiosko";

  const [path, setPath] = React.useState<string[]>([]);
  const [opening, setOpening] = React.useState<string | null>(null);
  const pick = (id: string) => { setPath((p) => [...p, id]); setOpening(null); };
  const go = (depth: number) => { setPath((p) => p.slice(0, depth)); setOpening(null); };

  const open = (route: string) => {
    // eslint-disable-next-line no-empty
    if (baseUrl) { try { window.open(baseUrl + route, "_blank", "noopener"); } catch {} }
    else { router.push(route); }
    setOpening(route);
    window.setTimeout(() => setOpening(null), 2200);
  };

  const { node } = nodeAt(path);
  const triageNode = TRIAGE.find((x) => x.id === path[path.length - 1]);
  const isLeaf = !!node.dest;
  const isTriage = !!node.triage;
  const isOptions = !isLeaf && !isTriage;

  // breadcrumbs
  const crumbs: { title: string; depth: number }[] = [];
  { let walk: Node = TREE; path.forEach((id, i) => { const c = childrenOf(walk).find((x) => x.id === id); if (!c) return; const tri = TRIAGE.find((x) => x.id === id); crumbs.push({ title: tri ? "Triage " + tri.label : c.title, depth: i + 1 }); walk = c; }); }

  const cols = isTriage ? (device === "kiosk" ? 1 : 5)
    : isOptions ? (() => { const n = (node.children || []).length; return device === "kiosk" ? (n >= 4 ? 2 : n) : (n >= 5 ? 3 : n <= 2 ? 2 : 3); })()
    : 1;

  const fontStack = "'Inter',system-ui,-apple-system,sans-serif";

  /* ── Cuerpo (compartido por ambos modos) ── */
  const Body = (
    <>
      {/* migas */}
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "13px 26px", background: t.railBg, borderBottom: `1px solid ${t.cardBorder}`, overflowX: "auto" }}>
        <button onClick={() => go(Math.max(0, path.length - 1))} disabled={path.length === 0}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", border: `1px solid ${t.cardBorder}`, cursor: "pointer", borderRadius: 9, background: t.cardBg, color: t.text, font: `600 13px ${fontStack}`, opacity: path.length === 0 ? 0.4 : 1 }}>
          <ChevronLeft size={15} /> Atrás
        </button>
        <div style={{ width: 1, height: 22, background: t.cardBorder, margin: "0 4px" }} />
        <button onClick={() => go(0)} style={{ padding: "8px 13px", border: "1px solid transparent", cursor: "pointer", borderRadius: 9, background: "transparent", color: t.muted, font: `600 13px ${fontStack}` }}>Servicios</button>
        {crumbs.map((c) => (
          <div key={c.depth} style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
            <ChevronRight size={14} style={{ color: t.muted, opacity: 0.6 }} />
            <button onClick={() => go(c.depth)} style={{ padding: "8px 13px", border: `1px solid ${t.cardBorder}`, cursor: "pointer", borderRadius: 9, background: t.cardBg, color: t.cardText, font: `700 13px ${fontStack}`, whiteSpace: "nowrap" }}>{c.title}</button>
          </div>
        ))}
      </div>

      {/* contenido */}
      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: device === "kiosk" ? "26px" : "28px 34px 32px" }}>
        {!isLeaf && (
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 18, marginBottom: 26, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: `700 12px ${fontStack}`, letterSpacing: ".14em", textTransform: "uppercase", color: isTriage ? RED : t.accent, marginBottom: 8 }}>{node.kicker}</div>
              <div style={{ fontFamily: fontStack, fontSize: device === "kiosk" ? 30 : 34, fontWeight: 800, lineHeight: 1.1, letterSpacing: "-.01em", maxWidth: "18ch" }}>{node.question}</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>{[0, 1, 2, 3].map((i) => <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: i <= path.length ? t.accent : t.cardBorder }} />)}</div>
          </div>
        )}

        {/* opciones */}
        {isOptions && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: device === "kiosk" ? 16 : 20 }}>
            {(node.children || []).map((c, i) => {
              const acc = dark ? mix(c.accent!, "#fff", 0.5) : c.accent!;
              const Icon = c.icon!;
              return (
                <button key={c.id} onClick={() => pick(c.id)}
                  style={{ display: "flex", flexDirection: "column", textAlign: "left", gap: 12, cursor: "pointer", padding: device === "kiosk" ? 22 : 24, border: `1.5px solid ${dark ? "rgba(255,255,255,.13)" : t.cardBorder}`, borderLeft: `6px solid ${acc}`, borderRadius: 16, background: t.cardBg, color: t.cardText, fontFamily: fontStack, boxShadow: "0 1px 2px rgba(16,22,50,.04)", transition: "transform .14s, box-shadow .15s, border-color .15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-5px)"; e.currentTarget.style.boxShadow = "0 18px 34px -14px rgba(16,22,50,.30)"; e.currentTarget.style.borderColor = acc; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 2px rgba(16,22,50,.04)"; e.currentTarget.style.borderColor = dark ? "rgba(255,255,255,.13)" : t.cardBorder; e.currentTarget.style.borderLeftColor = acc; }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: device === "kiosk" ? 56 : 60, height: device === "kiosk" ? 56 : 60, borderRadius: 14, background: dark ? alpha(acc, 0.18) : alpha(c.accent!, 0.1) }}><Icon size={device === "kiosk" ? 28 : 30} color={acc} strokeWidth={1.7} /></div>
                    <span style={{ font: `600 13px 'JetBrains Mono',monospace`, color: t.muted, opacity: 0.85 }}>{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <div style={{ fontSize: device === "kiosk" ? 22 : 23, fontWeight: 750, lineHeight: 1.12, letterSpacing: "-.01em" }}>{c.title}</div>
                  <div style={{ fontSize: 15, color: t.muted, lineHeight: 1.35 }}>{c.subtitle}</div>
                  <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 7, font: `700 13px ${fontStack}`, color: acc }}>{c.cta} <ArrowRight size={16} /></div>
                </button>
              );
            })}
          </div>
        )}

        {/* triage */}
        {isTriage && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: device === "kiosk" ? 16 : 20 }}>
            {TRIAGE.map((tr) => {
              const bg = destacado ? tr.hex : t.cardBg;
              const fg = destacado ? tr.fg : t.cardText;
              const disc = destacado ? (tr.dark ? "rgba(0,0,0,.16)" : "rgba(255,255,255,.22)") : tr.hex;
              const discText = destacado ? tr.fg : "#fff";
              const chip = destacado ? (tr.dark ? "rgba(0,0,0,.14)" : "rgba(255,255,255,.20)") : alpha(tr.hex, dark ? 0.26 : 0.14);
              const baseShadow = destacado ? `0 6px 22px -8px ${alpha(tr.hex, 0.5)}` : `inset 0 0 0 1.5px ${t.cardBorder}, inset 6px 0 0 ${tr.hex}`;
              const hoverShadow = destacado ? `0 18px 38px -10px ${alpha(tr.hex, 0.62)}` : `inset 0 0 0 1.5px ${tr.hex}, inset 6px 0 0 ${tr.hex}, 0 16px 32px -12px ${alpha(tr.hex, 0.4)}`;
              return (
                <button key={tr.id} onClick={() => pick(tr.id)}
                  style={{ display: "flex", flexDirection: device === "kiosk" ? "row" : "column", alignItems: "center", gap: device === "kiosk" ? 18 : 16, textAlign: "left", cursor: "pointer", padding: device === "kiosk" ? "20px 22px" : "24px 20px", border: "none", borderRadius: 16, background: bg, color: fg, fontFamily: fontStack, minHeight: device === "kiosk" ? 96 : 232, boxShadow: baseShadow, transition: "transform .14s, box-shadow .15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-5px)"; e.currentTarget.style.boxShadow = hoverShadow; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = baseShadow; }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: device === "kiosk" ? 58 : 62, height: device === "kiosk" ? 58 : 62, borderRadius: "50%", background: disc, color: discText, flex: "0 0 auto", fontWeight: 800, fontSize: device === "kiosk" ? 24 : 26 }}>{tr.code}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 auto" }}>
                    <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{tr.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, opacity: 0.92, lineHeight: 1.2 }}>{tr.care}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 3, padding: "4px 9px", borderRadius: 999, background: chip, font: `700 12px ${fontStack}`, alignSelf: "flex-start" }}><Clock size={13} /> {tr.target}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* derivación */}
        {isLeaf && (() => {
          const d = DEST[node.dest!] as DestKey;
          const isTri = !!triageNode;
          const deskBg = isTri ? `linear-gradient(150deg, ${triageNode!.hex}, ${alpha(triageNode!.hex, 0.82)})` : dark ? "linear-gradient(150deg,#174281,#0c2c57)" : estilo === "senaletica" ? "#10142e" : "#1F2145";
          const deskText = isTri && triageNode!.dark ? "#1a1505" : "#fff";
          const ScreenIcon = d.icon;
          const trail: string[] = []; { let w: Node = TREE; path.forEach((id) => { const c = childrenOf(w).find((x) => x.id === id); if (!c) return; const tri = TRIAGE.find((x) => x.id === id); trail.push(tri ? "Triage " + tri.label : c.title); w = c; }); }
          return (
            <div style={{ display: "flex", flexDirection: device === "kiosk" ? "column" : "row", gap: device === "kiosk" ? 18 : 22, alignItems: "stretch" }}>
              <div style={{ flex: device === "kiosk" ? "0 0 auto" : "1 1 42%", display: "flex", flexDirection: "column", gap: 18, padding: device === "kiosk" ? 26 : 30, borderRadius: 18, background: deskBg, color: deskText, boxShadow: "0 10px 30px -12px rgba(16,20,46,.6)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, font: `700 12px ${fontStack}`, letterSpacing: ".14em", textTransform: "uppercase", opacity: 0.82 }}><Check size={16} /> Diríjase a la ventanilla</div>
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: device === "kiosk" ? 86 : 96, height: device === "kiosk" ? 86 : 96, borderRadius: "50%", background: isTri && triageNode!.dark ? "rgba(0,0,0,.16)" : "rgba(255,255,255,.16)", color: deskText, font: `700 ${device === "kiosk" ? 30 : 34}px 'JetBrains Mono',monospace`, flex: "0 0 auto" }}>{d.deskCode}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: device === "kiosk" ? 26 : 30, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-.01em" }}>{d.deskName}</div>
                    <div style={{ fontSize: 14, opacity: 0.8, marginTop: 6 }}>{isTri ? `Nivel: ${triageNode!.care} · ${triageNode!.target}` : "Entregue el documento de pre-registro del paciente."}</div>
                  </div>
                </div>
                <div style={{ marginTop: "auto", display: "flex", flexWrap: "wrap", gap: 7, fontSize: 12.5, opacity: 0.9 }}>{trail.map((s, i) => <span key={i} style={{ padding: "5px 10px", borderRadius: 999, background: isTri && triageNode!.dark ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.12)", fontWeight: 600 }}>{s}</span>)}</div>
              </div>

              <div style={{ flex: device === "kiosk" ? "1 1 auto" : "1 1 58%", display: "flex", flexDirection: "column", gap: 14, padding: device === "kiosk" ? 26 : 30, borderRadius: 18, background: t.cardBg, border: `1.5px solid ${t.cardBorder}` }}>
                <div style={{ font: `700 12px ${fontStack}`, letterSpacing: ".14em", textTransform: "uppercase", color: t.muted }}>Pantalla del HIS a registrar</div>
                <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 60, height: 60, borderRadius: 15, background: dark ? alpha("#0975BA", 0.22) : alpha(t.accent, 0.1), flex: "0 0 auto" }}><ScreenIcon size={30} color={t.accent} strokeWidth={1.7} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: device === "kiosk" ? 22 : 24, fontWeight: 800, lineHeight: 1.1, color: t.cardText }}>{d.screen}</div>
                    <div style={{ fontSize: 13, color: t.muted, marginTop: 3 }}>Menú HIS · {d.section}</div>
                  </div>
                </div>
                {mostrarRutas && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 11, background: t.routeBg, border: `1px dashed ${t.routeBorder}`, flexWrap: "wrap" }}>
                    <span style={{ font: `700 11px ${fontStack}`, color: t.muted, textTransform: "uppercase", letterSpacing: ".1em" }}>Ruta</span>
                    <code style={{ font: `600 15px 'JetBrains Mono',monospace`, color: t.accent }}>{d.route}</code>
                  </div>
                )}
                {d.extra && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ font: `700 12px ${fontStack}`, color: t.muted }}>Pantallas relacionadas</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {d.extra.map((ex) => (
                        <button key={ex.route} onClick={() => open(ex.route)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 12px", borderRadius: 10, background: t.routeBg, border: `1px solid ${t.cardBorder}`, fontFamily: fontStack }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: t.cardText }}>{ex.label}</span>
                          <code style={{ font: `12.5px 'JetBrains Mono',monospace`, color: t.muted }}>{ex.route}</code>
                          <ArrowUpRight size={13} color={t.accent} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => open(d.route)} style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer", padding: 18, border: "none", borderRadius: 14, background: t.accent, color: t.accentText, font: `750 17px ${fontStack}`, boxShadow: `0 10px 24px -10px ${t.accentShadow}` }}>
                  Abrir pantalla en el HIS <ArrowUpRight size={20} />
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {opening && (
        <div style={{ position: "absolute", left: "50%", bottom: 26, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 12, padding: "15px 22px", borderRadius: 14, background: "#16181f", color: "#fff", boxShadow: "0 18px 44px -14px rgba(0,0,0,.6)", zIndex: 5 }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: "50%", background: "#16A34A" }}><Check size={15} color="#fff" strokeWidth={3} /></span>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Abriendo <code style={{ fontFamily: "'JetBrains Mono',monospace", color: "#7cc4ff" }}>{opening}</code> en el HIS…</span>
        </div>
      )}
    </>
  );

  /* ── Modo embebido (dentro del AppShell del HIS) ── */
  if (!kioskUI) {
    return <div style={{ position: "relative", display: "flex", flexDirection: "column", minHeight: 0, height: "100%", background: t.panelBg, color: t.text, borderRadius: 14, overflow: "hidden", border: `1px solid ${t.cardBorder}` }}>{Body}</div>;
  }

  /* ── Modo kiosko (pantalla completa) ──
     zIndex alto: la ruta /orientacion vive en el grupo (clinical), que monta el
     AppShell; este overlay cubre ese chrome (sidebar, header y el ChatWidget
     flotante z-50). Follow-up: mover a un route group sin AppShell. */
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 18, background: t.backdrop, fontFamily: fontStack }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", overflow: "hidden", background: t.panelBg, color: t.text, borderRadius: 20, boxShadow: "0 24px 80px -24px rgba(10,14,40,.55)", width: device === "kiosk" ? "min(880px,96vw)" : "min(1320px,97vw)", height: device === "kiosk" ? "min(1480px,96vh)" : "min(880px,95vh)", maxWidth: "98vw", maxHeight: "97vh" }}>
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 14, padding: device === "kiosk" ? "22px 26px" : "20px 30px", background: t.headerBg, color: t.headerText, borderBottom: `1px solid ${t.headerBorder}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 46, height: 46, borderRadius: 12, background: t.markBg }}><Activity size={26} color={t.markStroke} /></div>
          <div style={{ lineHeight: 1.05 }}>
            <div style={{ fontWeight: 800, letterSpacing: ".16em", fontSize: 18 }}>AVANTE</div>
            <div style={{ fontSize: 11, letterSpacing: ".04em", opacity: 0.72, textTransform: "uppercase" }}>Complejo Hospitalario · Orientación</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => go(0)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", border: "none", cursor: "pointer", borderRadius: 11, background: t.headBtn, color: t.headerText, font: `600 13px ${fontStack}` }}><Home size={16} /> Inicio</button>
            {/* Escape del kiosko → HIS normal. ?vista=completa evita que el landing
                de tablets vuelva a forzar kiosko (ver kiosk-auto-redirect.tsx). */}
            <button onClick={() => router.push("/dashboard?vista=completa")} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", border: "none", cursor: "pointer", borderRadius: 11, background: t.headBtn, color: t.headerText, font: `600 13px ${fontStack}` }}><Menu size={16} /> Menú normal</button>
          </div>
        </div>
        {Body}
      </div>
    </div>
  );
}

export default OrientacionKiosko;
