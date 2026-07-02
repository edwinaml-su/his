"use client";

/**
 * CalcModal — modal de cálculo del widget de calculadoras clínicas (CC-0009).
 *
 * Fiel al mockup docs/CC/0009/calculadoras-clinicas.html (openModal/compute).
 * Calcula en vivo con el MISMO motor del servidor (@his/infrastructure/formula)
 * — sin eval()/Function. "Insertar en nota" registra el cálculo (auditoría
 * hash-chain, CA-5) cuando hay contexto de paciente y copia el resultado al
 * portapapeles para pegarlo en la nota activa.
 */
import * as React from "react";
import { evaluar, type CalcDefFormula, type CalcDefScore } from "@his/infrastructure/formula";
import { trpc } from "@/lib/trpc/react";
import styles from "./calc-widget.module.css";
import { type WidgetCalc, tagGlyph, cx } from "./calc-shared";

interface CalcModalProps {
  calc: WidgetCalc;
  /** Paciente activo (si la ruta lo provee) — habilita el registro auditado. */
  pacienteId?: string;
  /** Pantalla actual del expediente — se guarda en el registro. */
  pantalla?: string;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export function CalcModal({ calc, pacienteId, pantalla, onClose, onToast }: CalcModalProps) {
  const isScore = calc.tipo === "score";

  // Estado de entradas: números/selects para fórmula-dosis; checkboxes para score.
  const [values, setValues] = React.useState<Record<string, string | number>>(() => {
    const init: Record<string, string | number> = {};
    if (!isScore) {
      for (const inp of (calc.def as CalcDefFormula).inputs) {
        init[inp.id] = inp.type === "select" ? inp.sel ?? 0 : inp.val ?? "";
      }
    }
    return init;
  });
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    if (isScore) {
      for (const it of (calc.def as CalcDefScore).items) init[it.id] = false;
    }
    return init;
  });

  // Animación de entrada (scale/translate) como en el mockup.
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const registrar = trpc.calculadoras.registrar.useMutation();

  const { resultado, interp } = React.useMemo(
    () =>
      evaluar(
        { tipo: calc.tipo, def: calc.def },
        isScore ? checked : values,
      ),
    [calc.tipo, calc.def, isScore, checked, values],
  );

  const finite = Number.isFinite(resultado);
  const band = !finite ? "rIdle" : interp ? `r${cap(interp.n)}` : "rIdle";
  const out = calc.def.out;

  function insertar() {
    if (!finite) return;
    const texto = `${calc.nombre}: ${resultado.toFixed(out.dec)} ${out.u}${interp ? ` — ${interp.t}` : ""}`;
    // Copia al portapapeles para pegar en la nota activa.
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(texto).catch(() => {});
    }
    // Registro auditado (CA-5) — solo con paciente en contexto.
    if (pacienteId) {
      registrar.mutate(
        {
          calculadoraId: calc.id,
          versionId: calc.versionId,
          pacienteId,
          entradas: isScore ? checked : values,
          resultado,
          interpretacion: interp?.t,
          pantalla,
        },
        {
          onSuccess: () => onToast("Resultado registrado y copiado para la nota"),
          onError: () => onToast("Resultado copiado (no se pudo registrar)"),
        },
      );
    } else {
      onToast("Resultado copiado — pégalo en la nota");
    }
    onClose();
  }

  return (
    <div
      className={cx(styles.vars, styles.mScrim, shown && styles.show)}
      role="dialog"
      aria-modal="true"
      aria-label={calc.nombre}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.mHead}>
          <div className={cx(styles.tag, styles[calc.tipo])}>{tagGlyph(calc.tipo)}</div>
          <div className={styles.ttl}>
            <h4>{calc.nombre}</h4>
            <div className={styles.ver}>
              <span className={styles.pill}>v{calc.ver}</span> {calc.categoria} · {calc.codigo}
            </div>
          </div>
          <button className={styles.x} onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className={styles.mBody}>
          {isScore ? (
            <>
              <div className={styles.optLbl}>Marque los criterios presentes</div>
              <div className={styles.opts}>
                {(calc.def as CalcDefScore).items.map((it) => (
                  <div
                    key={it.id}
                    className={cx(styles.opt, checked[it.id] && styles.sel)}
                    onClick={() => setChecked((c) => ({ ...c, [it.id]: !c[it.id] }))}
                  >
                    <div className={styles.ck}>✓</div>
                    <div className={styles.ol}>{it.label}</div>
                    <div className={styles.pts}>+{it.p}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            (calc.def as CalcDefFormula).inputs.map((inp) => (
              <div key={inp.id} className={styles.field}>
                <label>
                  {inp.label}
                  {inp.type !== "select" && inp.u ? <span className={styles.u}> · {inp.u}</span> : null}
                </label>
                {inp.type === "select" ? (
                  <select
                    className={styles.inp2}
                    value={Number(values[inp.id] ?? 0)}
                    onChange={(e) => setValues((v) => ({ ...v, [inp.id]: e.target.selectedIndex }))}
                  >
                    {(inp.opts ?? []).map((o, k) => (
                      <option key={k} value={k}>
                        {o.v}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className={styles.inp}>
                    <input
                      type="number"
                      step="any"
                      value={String(values[inp.id] ?? "")}
                      onChange={(e) => setValues((v) => ({ ...v, [inp.id]: e.target.value }))}
                    />
                    {inp.u ? <span className={styles.suf}>{inp.u}</span> : null}
                  </div>
                )}
                {inp.srcLabel && inp.val !== undefined ? (
                  <div className={styles.src}>
                    <span className={styles.d} /> {inp.srcLabel}
                  </div>
                ) : null}
              </div>
            ))
          )}

          <div className={cx(styles.result, styles[band as keyof typeof styles])}>
            <div className={styles.val}>
              <div className={cx(styles.n, styles.mono)}>
                {finite ? resultado.toFixed(out.dec) : "—"}
              </div>
              <div className={styles.un}>
                {finite && interp ? (
                  <>
                    {out.u} · <span style={{ fontWeight: 500 }}>{interp.t}</span>
                  </>
                ) : (
                  out.label
                )}
              </div>
            </div>
            {finite && interp ? (
              <div className={styles.interp}>
                <span className={styles.d} /> {interp.t}
              </div>
            ) : null}
          </div>

          {calc.altoRiesgo ? (
            <div className={styles.hrFlag}>
              <span className={styles.i}>⚠</span>
              <div>
                <b>Medicamento de alto riesgo.</b> Requiere verificación independiente por segundo
                clínico antes de insertar en indicaciones (IPSG.3).
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.mFoot}>
          <button className={cx(styles.cta, styles.ctaGhost)} onClick={onClose}>
            Cerrar
          </button>
          <button className={styles.cta} onClick={insertar} disabled={!finite}>
            Insertar en nota
          </button>
        </div>
        <div className={styles.disclaimer}>
          Herramienta de apoyo a la decisión clínica. El resultado no sustituye el juicio del
          profesional. Verifique los valores de entrada antes de documentar.
        </div>
      </div>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
