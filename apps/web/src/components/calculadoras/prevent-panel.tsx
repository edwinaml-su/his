"use client";

/**
 * PreventPanel — panel de cálculo de la calculadora nativa AHA PREVENT™ (CC-0009).
 *
 * Calculadora `tipo="nativo"`: a diferencia de fórmula/score/dosis (una salida),
 * PREVENT es una regresión logística con 5 desenlaces × 2 horizontes. Se calcula
 * en vivo con `calcularPrevent` (@his/infrastructure/formula) — mismo motor que
 * el servidor, sin eval()/Function. "Insertar en nota" registra el cálculo
 * (auditoría hash-chain, CA-5) usando el desenlace primario (ECV total) como
 * `resultado` y el desglose completo como interpretación.
 *
 * Cumplimiento: atribución AHA (PREVENT™) + cita del paper + disclaimer + límite
 * de edad 30–79 sin ECV establecida (sección 7 del requerimiento).
 */
import * as React from "react";
import {
  calcularPrevent,
  type CalcDefNativo,
} from "@his/infrastructure/formula";
import type {
  PreventHorizon,
  PreventInput,
  PreventModel,
  PreventOutcome,
  PreventSex,
} from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import styles from "./calc-widget.module.css";
import { cx, tagGlyph, type WidgetCalc } from "./calc-shared";

interface PreventPanelProps {
  calc: WidgetCalc;
  pacienteId?: string;
  pantalla?: string;
  onClose: () => void;
  onToast: (msg: string) => void;
}

const OUT_ORDER: PreventOutcome[] = [
  "total_cvd",
  "ascvd",
  "heart_failure",
  "chd",
  "stroke",
];

const OUT_LABEL: Record<PreventOutcome, string> = {
  total_cvd: "ECV total",
  ascvd: "ASCVD",
  heart_failure: "Insuf. cardíaca",
  chd: "Enf. coronaria",
  stroke: "Ictus (ACV)",
};

const MODEL_LABEL: Record<PreventModel, string> = {
  base: "modelo base",
  uacr: "modelo con UACR",
  hba1c: "modelo con HbA1c",
};

type NumKey =
  | "age"
  | "totalCholesterol"
  | "hdlCholesterol"
  | "systolicBP"
  | "eGFR"
  | "bmi";
type OptKey = "hba1c" | "uacr";
type BoolKey = "diabetes" | "smoking" | "onStatin" | "onBPMeds";

const NUM_FIELDS: { key: NumKey; label: string; u: string; ph: string }[] = [
  { key: "age", label: "Edad", u: "años", ph: "30–79" },
  { key: "totalCholesterol", label: "Colesterol total", u: "mg/dL", ph: "130–320" },
  { key: "hdlCholesterol", label: "HDL", u: "mg/dL", ph: "20–100" },
  { key: "systolicBP", label: "PA sistólica", u: "mmHg", ph: "90–180" },
  { key: "eGFR", label: "eGFR", u: "mL/min", ph: "15–140" },
  { key: "bmi", label: "IMC", u: "kg/m²", ph: "18.5–39.9" },
];

const OPT_FIELDS: { key: OptKey; label: string; u: string; ph: string }[] = [
  { key: "hba1c", label: "HbA1c (opcional)", u: "%", ph: "4.5–15" },
  { key: "uacr", label: "UACR (opcional)", u: "mg/g", ph: "0.1–25000" },
];

const BOOL_FIELDS: { key: BoolKey; label: string }[] = [
  { key: "diabetes", label: "Diabetes" },
  { key: "smoking", label: "Tabaquismo actual" },
  { key: "onStatin", label: "En estatina" },
  { key: "onBPMeds", label: "En antihipertensivo" },
];

const HORIZON_LABEL: Record<PreventHorizon, string> = {
  "10yr": "10 años",
  "30yr": "30 años",
};

function num(s: string | undefined): number | undefined {
  if (s == null || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

type Estado =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; risks: Record<PreventOutcome, number>; model: PreventModel };

export function PreventPanel({
  calc,
  pacienteId,
  pantalla,
  onClose,
  onToast,
}: PreventPanelProps) {
  const def = calc.def as CalcDefNativo;

  const [sex, setSex] = React.useState<PreventSex>("female");
  const [horizon, setHorizon] = React.useState<PreventHorizon>("10yr");
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [bools, setBools] = React.useState<Record<BoolKey, boolean>>({
    diabetes: false,
    smoking: false,
    onStatin: false,
    onBPMeds: false,
  });

  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const registrar = trpc.calculadoras.registrar.useMutation();

  const buildInput = React.useCallback((): PreventInput | null => {
    const req: Record<NumKey, number | undefined> = {
      age: num(vals.age),
      totalCholesterol: num(vals.totalCholesterol),
      hdlCholesterol: num(vals.hdlCholesterol),
      systolicBP: num(vals.systolicBP),
      eGFR: num(vals.eGFR),
      bmi: num(vals.bmi),
    };
    for (const k of Object.keys(req) as NumKey[]) {
      if (req[k] === undefined) return null; // faltan datos → estado idle
    }
    const hba1c = num(vals.hba1c);
    const uacr = num(vals.uacr);
    return {
      sex,
      horizon,
      age: req.age!,
      totalCholesterol: req.totalCholesterol!,
      hdlCholesterol: req.hdlCholesterol!,
      systolicBP: req.systolicBP!,
      eGFR: req.eGFR!,
      bmi: req.bmi!,
      diabetes: bools.diabetes,
      smoking: bools.smoking,
      onStatin: bools.onStatin,
      onBPMeds: bools.onBPMeds,
      ...(hba1c !== undefined ? { hba1c } : {}),
      ...(uacr !== undefined ? { uacr } : {}),
    };
  }, [vals, sex, horizon, bools]);

  const estado: Estado = React.useMemo(() => {
    const input = buildInput();
    if (!input) return { status: "idle" };
    try {
      const res = calcularPrevent(input);
      return { status: "ok", risks: res.risks, model: res.model };
    } catch (e) {
      const message =
        e && typeof e === "object" && "issues" in e
          ? ((e as { issues: { message: string }[] }).issues[0]?.message ??
            "Revise los valores ingresados.")
          : "Revise los valores ingresados.";
      return { status: "error", message };
    }
  }, [buildInput]);

  const ok = estado.status === "ok";

  function insertar() {
    if (estado.status !== "ok") return;
    const desglose = OUT_ORDER.map(
      (o) => `${OUT_LABEL[o]} ${estado.risks[o].toFixed(1)}%`,
    ).join(" · ");
    const texto =
      `${calc.nombre} (${HORIZON_LABEL[horizon]}, ${MODEL_LABEL[estado.model]}): ${desglose}`.slice(
        0,
        500,
      );

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(texto).catch(() => {});
    }

    const input = buildInput();
    if (pacienteId && input) {
      const entradas: Record<string, string | number | boolean> = {
        sex: input.sex,
        horizon: input.horizon,
        age: input.age,
        totalCholesterol: input.totalCholesterol,
        hdlCholesterol: input.hdlCholesterol,
        systolicBP: input.systolicBP,
        eGFR: input.eGFR,
        bmi: input.bmi,
        diabetes: input.diabetes,
        smoking: input.smoking,
        onStatin: input.onStatin,
        onBPMeds: input.onBPMeds,
      };
      if (input.hba1c !== undefined) entradas.hba1c = input.hba1c;
      if (input.uacr !== undefined) entradas.uacr = input.uacr;
      registrar.mutate(
        {
          calculadoraId: calc.id,
          versionId: calc.versionId,
          pacienteId,
          entradas,
          resultado: estado.risks.total_cvd,
          interpretacion: texto,
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
          <div className={cx(styles.tag, styles.nativo)}>{tagGlyph("nativo")}</div>
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
          {/* Sexo */}
          <div className={styles.field}>
            <label>Sexo</label>
            <div className={styles.prevSeg} role="group" aria-label="Sexo">
              <button
                type="button"
                className={cx(styles.prevSegBtn, sex === "female" && styles.prevSegOn)}
                onClick={() => setSex("female")}
              >
                Femenino
              </button>
              <button
                type="button"
                className={cx(styles.prevSegBtn, sex === "male" && styles.prevSegOn)}
                onClick={() => setSex("male")}
              >
                Masculino
              </button>
            </div>
          </div>

          {/* Horizonte */}
          <div className={styles.field}>
            <label>Horizonte</label>
            <div className={styles.prevSeg} role="group" aria-label="Horizonte">
              <button
                type="button"
                className={cx(styles.prevSegBtn, horizon === "10yr" && styles.prevSegOn)}
                onClick={() => setHorizon("10yr")}
              >
                10 años
              </button>
              <button
                type="button"
                className={cx(styles.prevSegBtn, horizon === "30yr" && styles.prevSegOn)}
                onClick={() => setHorizon("30yr")}
              >
                30 años
              </button>
            </div>
          </div>

          {/* Numéricos requeridos */}
          <div className={styles.prevGrid2}>
            {NUM_FIELDS.map((f) => (
              <div key={f.key} className={styles.field}>
                <label>
                  {f.label}
                  <span className={styles.u}> · {f.u}</span>
                </label>
                <div className={styles.inp}>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder={f.ph}
                    value={vals[f.key] ?? ""}
                    onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  <span className={styles.suf}>{f.u}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Opcionales — seleccionan el modelo (hba1c › uacr › base) */}
          <div className={styles.prevGrid2}>
            {OPT_FIELDS.map((f) => (
              <div key={f.key} className={styles.field}>
                <label>
                  {f.label}
                  <span className={styles.u}> · {f.u}</span>
                </label>
                <div className={styles.inp}>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder={f.ph}
                    value={vals[f.key] ?? ""}
                    onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  <span className={styles.suf}>{f.u}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Booleanos */}
          <div className={styles.opts}>
            {BOOL_FIELDS.map((b) => (
              <div
                key={b.key}
                className={cx(styles.opt, bools[b.key] && styles.sel)}
                onClick={() => setBools((s) => ({ ...s, [b.key]: !s[b.key] }))}
              >
                <div className={styles.ck}>✓</div>
                <div className={styles.ol}>{b.label}</div>
              </div>
            ))}
          </div>

          {/* Resultados */}
          {estado.status === "error" ? (
            <div className={styles.hrFlag}>
              <span className={styles.i}>⚠</span>
              <div>{estado.message}</div>
            </div>
          ) : ok ? (
            <>
              <div className={styles.prevMeta}>
                Riesgo a {HORIZON_LABEL[horizon]} · {MODEL_LABEL[estado.model]}
              </div>
              <div className={styles.prevOuts}>
                {OUT_ORDER.map((o) => (
                  <div
                    key={o}
                    className={cx(styles.prevOut, o === "total_cvd" && styles.prevPrimary)}
                  >
                    <div className={styles.prevOutName}>{OUT_LABEL[o]}</div>
                    <div className={cx(styles.prevOutVal, styles.mono)}>
                      {estado.risks[o].toFixed(1)}
                      <span style={{ fontSize: "0.5em", fontWeight: 500 }}> %</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.prevMeta}>
              Complete edad, colesterol total, HDL, PA sistólica, eGFR e IMC para estimar el riesgo.
            </div>
          )}
        </div>

        <div className={styles.mFoot}>
          <button className={cx(styles.cta, styles.ctaGhost)} onClick={onClose}>
            Cerrar
          </button>
          <button className={styles.cta} onClick={insertar} disabled={!ok}>
            Insertar en nota
          </button>
        </div>
        <div className={styles.disclaimer}>
          {def.disclaimer ??
            "Solo con fines informativos. No reemplaza el juicio clínico. Válido en adultos 30–79 años sin ECV establecida."}
        </div>
        <div className={styles.prevAttr}>
          {def.attribution ??
            "Ecuaciones © American Heart Association (PREVENT™). Khan SS et al., Circulation 2024. Implementación de referencia: preventr (MIT)."}
        </div>
      </div>
    </div>
  );
}
