"use client";

import * as React from "react";
import styles from "./login.module.css";
import { buildBlocks, buildTraces, pct } from "./animation-data";

/** Hitos de la línea de tiempo (ms) — idénticos a `startTimeline()` del mockup. */
const T_SCENE2 = 2400;
const T_SCENE3 = 6400;
const T_HUD_DONE = 8600;
const T_DOCK = 10500;
const T_CARD = 12600;
/** El tick del HUD deja de correr tras 9s (mockup: `if(t<9) rafId=...`). */
const T_HUD_TICK_STOP = 9;

type CssVars = React.CSSProperties & Record<`--${string}`, string>;

export interface LoginStageProps {
  /** true = reduced-motion u ?skipIntro=1: salta directo al estado final (logo dockeado, HUD oculto). */
  skip: boolean;
  /** Se dispara cuando la animación llega al punto de mostrar la tarjeta (12.6s, o inmediato si `skip`). */
  onReachCardStep: () => void;
}

/**
 * Escenario animado del login AxisMed (circuito, pulsos, cruz, marca, HUD).
 * Puramente decorativo — la tarjeta de login vive fuera de este componente.
 * Se remonta con un `key` distinto desde el padre para "reiniciar" la animación
 * (evita el hack de `cloneNode` del mockup: React ya recrea todo el árbol).
 */
export function LoginStage({ skip, onReachCardStep }: LoginStageProps): React.JSX.Element {
  const traces = React.useMemo(() => buildTraces(), []);
  const blocks = React.useMemo(() => buildBlocks(), []);

  const [scale, setScale] = React.useState(1);
  const [phase2, setPhase2] = React.useState(skip);
  const [phase3, setPhase3] = React.useState(skip);
  const [hudDone, setHudDone] = React.useState(skip);
  const [docked, setDocked] = React.useState(skip);
  const [hudPct, setHudPct] = React.useState(skip ? 100 : 0);
  const [hudLabel, setHudLabel] = React.useState<"start" | "loading" | "ready">(
    skip ? "ready" : "start",
  );

  // Escalado del escenario 1280x720 al viewport disponible (fit()).
  React.useEffect(() => {
    function fit() {
      const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720) * 0.97;
      setScale(s);
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Línea de tiempo de la animación.
  React.useEffect(() => {
    if (skip) {
      onReachCardStep();
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    const sched = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    sched(T_SCENE2, () => setPhase2(true));
    sched(T_SCENE3, () => {
      setPhase3(true);
      setHudLabel("ready");
    });
    sched(T_HUD_DONE, () => setHudDone(true));
    sched(T_DOCK, () => setDocked(true));
    sched(T_CARD, onReachCardStep);

    const t0 = performance.now();
    let rafId = requestAnimationFrame(tick);
    function tick(now: number) {
      const t = (now - t0) / 1000;
      const p = pct(t);
      setHudPct(p);
      setHudLabel(t >= T_SCENE3 / 1000 ? "ready" : t < T_SCENE2 / 1000 ? "start" : "loading");
      if (t < T_HUD_TICK_STOP) rafId = requestAnimationFrame(tick);
    }

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  const hudLabelText =
    hudLabel === "ready"
      ? "LISTO · READY"
      : hudLabel === "loading"
        ? "CARGANDO MÓDULOS · LOADING MODULES"
        : "INICIANDO SISTEMA · SYSTEM LOADING";

  const stageClassName = [
    styles.stage,
    phase2 && styles.s2,
    phase3 && styles.s3,
    hudDone && styles.hudDone,
    skip && styles.noMotion,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.stageWrap} aria-hidden="true">
      <div className={stageClassName} style={{ transform: `scale(${scale})` }}>
        <div className={styles.grid} />
        <div className={styles.camera}>
          <div className={styles.circuit}>
            <svg width={1280} height={720} viewBox="0 0 1280 720">
              {traces.map((tr) => (
                <React.Fragment key={tr.key}>
                  <path
                    className={styles.trace}
                    d={tr.d}
                    pathLength={1}
                    style={{ animationDelay: tr.traceDelay }}
                  />
                  <circle
                    className={styles.ring}
                    cx={tr.ringCx}
                    cy={tr.ringCy}
                    r={5}
                    style={{ animationDelay: tr.traceDelay }}
                  />
                  {tr.pads.map((pad) => (
                    <circle
                      key={pad.key}
                      className={styles.pad}
                      cx={pad.cx}
                      cy={pad.cy}
                      r={3.5}
                      style={{ animationDelay: pad.delay }}
                    />
                  ))}
                </React.Fragment>
              ))}
            </svg>
          </div>
          <div className={styles.pulses}>
            {traces.map((tr) => (
              <div
                key={tr.key}
                className={styles.pulse}
                style={{ offsetPath: `path('${tr.d}')`, animationDelay: tr.pulseDelay } as CssVars}
              />
            ))}
          </div>
          <div className={styles.shock} />
          <div className={[styles.logoGroup, docked && styles.dock].filter(Boolean).join(" ")}>
            <div className={styles.crossPos}>
              <div className={styles.crossMove}>
                <div className={styles.halo} />
                <div className={styles.cross}>
                  {blocks.map((b) => (
                    <div
                      key={b.key}
                      className={styles.block}
                      style={
                        {
                          left: `${b.left}px`,
                          top: `${b.top}px`,
                          background: b.background,
                          "--dx": b.dx,
                          "--dy": b.dy,
                          "--d": b.delay,
                        } as CssVars
                      }
                    />
                  ))}
                  <div className={styles.xline + " " + styles.lineV} />
                  <div className={styles.xline + " " + styles.lineH} />
                </div>
                <div className={styles.node} />
              </div>
            </div>
            <div className={styles.brand}>
              <div className={styles.wordmark}>
                <span className={styles.axis}>Axis</span>
                <span className={styles.med}>Med</span>
              </div>
              <div className={styles.byrow}>
                <div className={styles.redbar} />
                <div className={styles.bytext}>BY AVANTE</div>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.hud}>
          <div className={styles.hudLabel}>{hudLabelText}</div>
          <div className={styles.hudPct}>{Math.round(hudPct)}%</div>
          <div className={styles.hudBar}>
            <div className={styles.hudFill} style={{ width: `${hudPct}%` }} />
          </div>
        </div>
        <div className={styles.vignette} />
      </div>
    </div>
  );
}
