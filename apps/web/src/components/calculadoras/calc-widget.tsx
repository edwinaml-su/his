"use client";

/**
 * CalcWidget — barra flotante de calculadoras clínicas (CC-0009).
 *
 * Fiel al mockup docs/CC/0009/calculadoras-clinicas.html: barra centrada abajo,
 * arrastrable por el asa ⠿, autocompletado fantasma (Tab/→), navegación por
 * teclado (↑↓/Enter/Esc) y atajo Ctrl+Shift+K. Consume el catálogo publicado
 * (`calculadoras.paraWidget`) filtrado por pantalla actual; abre el modal de
 * cálculo. Oculta en rutas /admin (ahí vive el catálogo de administración).
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import styles from "./calc-widget.module.css";
import { CalcModal } from "./calc-modal";
import { CAT_ORDER, cx, pantallaDeRuta, tagGlyph, type WidgetCalc } from "./calc-shared";

const RECIENTES_KEY = "his.calc.recientes";
const MAX_RECIENTES = 5;

type Grupo = [string, WidgetCalc[]];

function construirGrupos(pool: WidgetCalc[], q: string, recientes: string[]): Grupo[] {
  const f = q.trim().toLowerCase();
  const grupos: Grupo[] = [];
  if (!f) {
    const rec = recientes
      .map((code) => pool.find((c) => c.codigo === code))
      .filter((c): c is WidgetCalc => Boolean(c));
    if (rec.length) grupos.push(["Recientes", rec]);
    const known = new Set(CAT_ORDER);
    for (const cat of CAT_ORDER) {
      const items = pool.filter((c) => c.categoria === cat);
      if (items.length) grupos.push([cat, items]);
    }
    const rest = [...new Set(pool.filter((c) => !known.has(c.categoria)).map((c) => c.categoria))];
    for (const cat of rest) grupos.push([cat, pool.filter((c) => c.categoria === cat)]);
  } else {
    const match = pool.filter(
      (c) =>
        c.nombre.toLowerCase().includes(f) ||
        c.categoria.toLowerCase().includes(f) ||
        (c.sub ?? "").toLowerCase().includes(f) ||
        c.codigo.toLowerCase().includes(f),
    );
    grupos.push([`Resultados (${match.length})`, match]);
  }
  return grupos;
}

export function CalcWidget({ pacienteId }: { pacienteId?: string }) {
  const pathname = usePathname();
  const hidden = pathname.startsWith("/admin");
  const pantalla = pantallaDeRuta(pathname);

  const query = trpc.calculadoras.paraWidget.useQuery(
    { pantalla },
    { enabled: !hidden, staleTime: 60_000 },
  );
  const pool = (query.data ?? []) as unknown as WidgetCalc[];

  const [active, setActive] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const [below, setBelow] = React.useState(false);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const [recientes, setRecientes] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<WidgetCalc | null>(null);
  const [toast, setToast] = React.useState<{ msg: string; shown: boolean }>({ msg: "", shown: false });

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const barRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout>>();

  // Recientes persistidos por usuario/navegador.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECIENTES_KEY);
      if (raw) setRecientes(JSON.parse(raw) as string[]);
    } catch {
      /* noop */
    }
  }, []);

  const grupos = React.useMemo(() => construirGrupos(pool, q, recientes), [pool, q, recientes]);
  const flat = React.useMemo(() => grupos.flatMap((g) => g[1]), [grupos]);

  // Autocompletado fantasma: primer resultado cuyo nombre empieza por lo tecleado.
  const sugerencia = React.useMemo(() => {
    const typed = q;
    if (!typed) return "";
    const hit = flat.find((c) => c.nombre.toLowerCase().startsWith(typed.toLowerCase()));
    return hit && hit.nombre.length > typed.length ? hit.nombre : "";
  }, [q, flat]);

  // Posiciona resultados arriba/abajo según espacio (positionResults del mockup).
  React.useEffect(() => {
    if (!active) return;
    const recompute = () => {
      const r = barRef.current?.getBoundingClientRect();
      if (!r) return;
      const need = Math.min(window.innerHeight * 0.52, 440) + 14;
      setBelow(r.top < need);
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [active, q, pos]);

  // Scroll del item activo a la vista.
  React.useEffect(() => {
    resultsRef.current
      ?.querySelector<HTMLElement>(`[data-i="${idx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  // Atajo Ctrl+Shift+K (Ctrl+K queda para la paleta de comandos existente).
  React.useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden]);

  // Click fuera → cerrar resultados.
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setActive(false);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Arrastre por el asa.
  const drag = React.useRef<{ on: boolean; offX: number; offY: number }>({ on: false, offX: 0, offY: 0 });
  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current.on || !wrapRef.current || !barRef.current) return;
      const w = wrapRef.current.offsetWidth;
      const h = barRef.current.offsetHeight;
      const left = Math.max(8, Math.min(e.clientX - drag.current.offX, window.innerWidth - w - 8));
      const top = Math.max(8, Math.min(e.clientY - drag.current.offY, window.innerHeight - h - 8));
      setPos({ left, top });
    };
    const onUp = () => {
      drag.current.on = false;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  function startDrag(e: React.PointerEvent) {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { on: true, offX: e.clientX - r.left, offY: e.clientY - r.top };
    setPos({ left: r.left, top: r.top });
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  function showToast(msg: string) {
    setToast({ msg, shown: true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, shown: false })), 2600);
  }

  function abrir(c: WidgetCalc) {
    setSelected(c);
    setActive(false);
    setRecientes((prev) => {
      const next = [c.codigo, ...prev.filter((x) => x !== c.codigo)].slice(0, MAX_RECIENTES);
      try {
        window.localStorage.setItem(RECIENTES_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  }

  function aceptarSugerencia(): boolean {
    if (!sugerencia) return false;
    setQ(sugerencia);
    setIdx(0);
    return true;
  }

  function navKeys(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab") {
      if (sugerencia) {
        e.preventDefault();
        aceptarSugerencia();
      }
    } else if (e.key === "ArrowRight") {
      const el = e.currentTarget;
      const atEnd = el.selectionStart === el.value.length && el.selectionStart === el.selectionEnd;
      if (atEnd && sugerencia) {
        e.preventDefault();
        aceptarSugerencia();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = flat[idx];
      if (c) abrir(c);
    } else if (e.key === "Escape") {
      inputRef.current?.blur();
      setActive(false);
    }
  }

  if (hidden) return null;

  const wrapStyle: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto", transform: "none" }
    : {};

  let flatIdx = 0;

  return (
    <div className={cx(styles.vars)}>
      <div ref={wrapRef} className={styles.floatWrap} style={wrapStyle}>
        {/* Resultados (popover) */}
        <div
          ref={resultsRef}
          className={cx(styles.results, active && styles.show, below && styles.below)}
          role="listbox"
          aria-label="Calculadoras"
        >
          {flat.length === 0 ? (
            <div className={styles.resEmpty}>Sin resultados. Prueba con otro nombre o código.</div>
          ) : (
            <>
              {grupos.map(([label, items]) =>
                items.length ? (
                  <React.Fragment key={label}>
                    <div className={styles.resGrp}>{label}</div>
                    {items.map((c) => {
                      const gi = flatIdx++;
                      return (
                        <div
                          key={`${label}-${c.id}`}
                          data-i={gi}
                          className={cx(styles.resItem, gi === idx && styles.active)}
                          role="option"
                          aria-selected={gi === idx}
                          onMouseMove={() => setIdx(gi)}
                          onClick={() => abrir(c)}
                        >
                          <div className={cx(styles.tag, styles[c.tipo])}>{tagGlyph(c.tipo)}</div>
                          <div className={styles.nm}>
                            <b>{c.nombre}</b>
                            <span>{c.sub}</span>
                          </div>
                          <div className={styles.meta}>
                            {c.altoRiesgo ? <span className={styles.hrDot}>Alto riesgo</span> : null}
                            <span className={styles.ent}>↵</span>
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ) : null,
              )}
              <div className={styles.resFoot}>
                <span>
                  <kbd>↑↓</kbd>navegar
                </span>
                <span>
                  <kbd>↵</kbd>abrir
                </span>
                <span>
                  <kbd>esc</kbd>cerrar
                </span>
              </div>
            </>
          )}
        </div>

        {/* Barra */}
        <div
          ref={barRef}
          className={cx(styles.fbar, active && styles.fbarActive, drag.current.on && styles.grabbing)}
          onClick={(e) => {
            if (e.target === e.currentTarget) inputRef.current?.focus();
          }}
        >
          <div
            className={styles.grip}
            title="Arrastrar para mover"
            aria-label="Mover barra"
            onPointerDown={startDrag}
          >
            ⠿
          </div>
          <span className={styles.mag}>⌕</span>
          <div className={styles.inpWrap} onClick={() => inputRef.current?.focus()}>
            <div className={styles.ghost} aria-hidden="true">
              {sugerencia ? (
                <>
                  <span className={styles.gTyped}>{q}</span>
                  <span className={styles.gRest}>{sugerencia.slice(q.length)}</span>
                </>
              ) : null}
            </div>
            <input
              ref={inputRef}
              className={styles.input}
              placeholder="Buscar calculadora clínica…"
              autoComplete="off"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setIdx(0);
              }}
              onFocus={() => setActive(true)}
              onKeyDown={navKeys}
            />
          </div>
          <span className={styles.hint}>{active ? "esc" : "Ctrl ⇧ K"}</span>
        </div>
      </div>

      {selected ? (
        <CalcModal
          calc={selected}
          pacienteId={pacienteId}
          pantalla={pantalla}
          onClose={() => setSelected(null)}
          onToast={showToast}
        />
      ) : null}

      <div className={cx(styles.toast, toast.shown && styles.toastShow)}>
        <span className={styles.ic}>✓</span>
        <span>{toast.msg}</span>
      </div>
    </div>
  );
}
