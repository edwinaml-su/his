"use client";

/**
 * GestionModal — editor/gestión de una calculadora (CC-0009, `ed-scrim` del mockup).
 *
 * Para una calculadora existente: muestra identificación + definición (inmutable),
 * vista previa en vivo con el motor, gestión de casos de prueba (agregar/correr) y
 * el gate de publicación (CA-2: casos en verde · CA-6: validación clínica).
 * Editar la definición crea una versión nueva (inmutabilidad) — fuera del alcance
 * de v1: la biblioteca se siembra y aquí se valida y publica.
 */
import * as React from "react";
import {
  evaluar,
  type CalcDef,
  type CalcDefFormula,
  type CalcDefScore,
} from "@his/infrastructure/formula";
import { trpc } from "@/lib/trpc/react";
import { cx, tagGlyph } from "@/components/calculadoras/calc-shared";
import styles from "./calc-admin.module.css";
import { PantallaGrid, type PaginasScope, type PantallaItem } from "./pantalla-grid";

const TIPO_LABEL: Record<string, string> = {
  formula: "FORMULA",
  score: "SCORE",
  dosis: "DOSIS",
};

/** Entradas por defecto para la vista previa (usa `val`/`sel` de la definición). */
function entradasDefault(tipo: string, def: CalcDef): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (tipo === "score") {
    for (const it of (def as CalcDefScore).items) out[it.id] = false;
  } else {
    for (const inp of (def as CalcDefFormula).inputs) {
      out[inp.id] = inp.type === "select" ? inp.sel ?? 0 : inp.val ?? 0;
    }
  }
  return out;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function GestionModal({
  calcId,
  pantallas,
  onClose,
  onChanged,
  onToast,
}: {
  calcId: string;
  pantallas: PantallaItem[];
  onClose: () => void;
  onChanged: () => void;
  onToast: (msg: string) => void;
}) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const utils = trpc.useUtils();
  const detalle = trpc.calculadoras.get.useQuery({ id: calcId });
  const calc = detalle.data;
  const versionId = calc?.versionId ?? null;

  const casosQuery = trpc.calculadoras.casos.useQuery(
    { versionId: versionId ?? "" },
    { enabled: Boolean(versionId) },
  );
  const casos = casosQuery.data ?? [];

  const setPaginas = trpc.calculadoras.setPaginas.useMutation();
  const correrCasos = trpc.calculadoras.correrCasos.useMutation();
  const agregarCaso = trpc.calculadoras.agregarCasoPrueba.useMutation();
  const publicar = trpc.calculadoras.publicar.useMutation();

  const [valida, setValida] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [addEntradas, setAddEntradas] = React.useState("{}");
  const [addEsperado, setAddEsperado] = React.useState("");
  const [addTol, setAddTol] = React.useState("0.1");

  // Vista previa en vivo con las entradas por defecto de la definición.
  const preview = React.useMemo(() => {
    if (!calc?.def) return null;
    try {
      return evaluar({ tipo: calc.tipo, def: calc.def }, entradasDefault(calc.tipo, calc.def));
    } catch {
      return null;
    }
  }, [calc?.tipo, calc?.def]);

  const total = casos.length;
  const pasan = casos.filter((c) => c.resultado === "pasa").length;
  const gateOk = total > 0 && pasan === total;
  const yaPublicada = calc?.estado === "publicada";

  function refetchAll() {
    void utils.calculadoras.get.invalidate({ id: calcId });
    if (versionId) void utils.calculadoras.casos.invalidate({ versionId });
    onChanged();
  }

  function guardarPantallas(scope: PaginasScope) {
    setPaginas.mutate(
      { id: calcId, paginas: scope },
      {
        onSuccess: () => refetchAll(),
        onError: (e) => onToast(e.message),
      },
    );
  }

  function correr() {
    if (!versionId) return;
    correrCasos.mutate(
      { versionId },
      {
        onSuccess: (r) => {
          if (versionId) void utils.calculadoras.casos.invalidate({ versionId });
          onToast(`Casos ejecutados: ${r.pasan}/${r.total} en verde`);
        },
        onError: (e) => onToast(e.message),
      },
    );
  }

  function agregar() {
    if (!versionId) return;
    let entradas: Record<string, string | number | boolean>;
    try {
      entradas = JSON.parse(addEntradas) as Record<string, string | number | boolean>;
    } catch {
      onToast("Entradas: JSON inválido");
      return;
    }
    const esperado = Number(addEsperado);
    const tolerancia = Number(addTol);
    if (!Number.isFinite(esperado) || !Number.isFinite(tolerancia)) {
      onToast("Esperado/tolerancia deben ser numéricos");
      return;
    }
    agregarCaso.mutate(
      { versionId, entradas, esperado, tolerancia },
      {
        onSuccess: () => {
          if (versionId) void utils.calculadoras.casos.invalidate({ versionId });
          setAddOpen(false);
          setAddEntradas("{}");
          setAddEsperado("");
          onToast("Caso de prueba agregado");
        },
        onError: (e) => onToast(e.message),
      },
    );
  }

  function publicarAhora() {
    if (!versionId) return;
    publicar.mutate(
      { id: calcId, versionId, validacionClinica: true },
      {
        onSuccess: () => {
          onToast(`Versión ${calc?.ver ?? ""} publicada`);
          refetchAll();
          onClose();
        },
        onError: (e) => onToast(e.message),
      },
    );
  }

  const out = calc?.def && "out" in calc.def ? calc.def.out : null;
  const band = !preview || !Number.isFinite(preview.resultado)
    ? "rIdle"
    : preview.interp
      ? `r${cap(preview.interp.n)}`
      : "rIdle";

  return (
    <div
      className={cx(styles.vars, styles.edScrim, shown && styles.show)}
      role="dialog"
      aria-modal="true"
      aria-label="Gestión de calculadora"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.editor}>
        <div className={styles.edHead}>
          <h3>{calc ? calc.nombre : "Cargando…"}</h3>
          {calc ? (
            <span className={cx(styles.chip, styles[calc.tipo as "formula" | "score" | "dosis"])}>
              {tagGlyph(calc.tipo)} {TIPO_LABEL[calc.tipo]}
            </span>
          ) : null}
          <button className={styles.x} onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {calc ? (
          <div className={styles.edBody}>
            {/* Columna izquierda — identificación + definición */}
            <div className={styles.edForm}>
              <div className={cx(styles.edSec, styles.edSecFirst)}>Identificación</div>
              <div className={styles.fg2}>
                <div className={styles.fg}>
                  <label>Código</label>
                  <input value={calc.codigo} readOnly className={styles.readonly} />
                </div>
                <div className={styles.fg}>
                  <label>Versión actual</label>
                  <input value={calc.ver ? `v${calc.ver}` : "—"} readOnly className={styles.readonly} />
                </div>
              </div>
              <div className={styles.fg}>
                <label>Nombre</label>
                <input value={calc.nombre} readOnly className={styles.readonly} />
              </div>
              <div className={styles.fg2}>
                <div className={styles.fg}>
                  <label>Categoría</label>
                  <input value={calc.categoria} readOnly className={styles.readonly} />
                </div>
                <div className={styles.fg}>
                  <label>Nivel de riesgo</label>
                  <input
                    value={calc.altoRiesgo ? "Alto riesgo" : "Estándar"}
                    readOnly
                    className={styles.readonly}
                  />
                </div>
              </div>

              <div className={styles.edSec}>Definición</div>
              {calc.def && "expr" in calc.def ? (
                <div className={styles.fg}>
                  <label>Expresión</label>
                  <textarea value={calc.def.expr} readOnly className={styles.readonly} />
                </div>
              ) : (
                <div className={styles.fg}>
                  <label>Ítems del score</label>
                  <textarea
                    value={(calc.def as CalcDefScore | null)?.items
                      .map((it) => `${it.label} (+${it.p})`)
                      .join("\n")}
                    readOnly
                    className={styles.readonly}
                  />
                </div>
              )}
              {out ? (
                <div className={styles.fg}>
                  <label>Unidad de salida</label>
                  <input value={out.u} readOnly className={styles.readonly} />
                </div>
              ) : null}

              {calc.ref ? (
                <>
                  <div className={styles.edSec}>Referencia</div>
                  <div className={styles.fg}>
                    <label>Fuente bibliográfica</label>
                    <input value={calc.ref} readOnly className={styles.readonly} />
                  </div>
                </>
              ) : null}

              <div className={styles.edSec}>Visibilidad por pantalla</div>
              <PantallaGrid
                value={(calc.paginas as PaginasScope) ?? "*"}
                pantallas={pantallas}
                onChange={guardarPantallas}
              />
            </div>

            {/* Columna derecha — vista previa + casos de prueba */}
            <div className={styles.edPrev}>
              <div className={styles.pvLabel}>
                <span className={styles.pvDot} /> Vista previa en vivo
              </div>
              <div className={cx(styles.result, styles[band as keyof typeof styles])}>
                <div className={styles.val}>
                  <div className={cx(styles.n, styles.mono)}>
                    {preview && Number.isFinite(preview.resultado)
                      ? preview.resultado.toFixed(out?.dec ?? 0)
                      : "—"}
                  </div>
                  <div className={styles.un}>{out?.u ?? out?.label ?? ""}</div>
                </div>
                {preview?.interp ? (
                  <div className={styles.interp}>
                    <span className={styles.d} /> {preview.interp.t}
                  </div>
                ) : null}
              </div>

              <div className={styles.edSec}>
                Casos de prueba{" "}
                <span className={styles.edSecNote}>· requisito de publicación</span>
              </div>
              {casos.length === 0 ? (
                <div className={styles.note} style={{ marginBottom: 8 }}>
                  Sin casos. Agrega al menos uno para poder publicar.
                </div>
              ) : (
                casos.map((c) => (
                  <div
                    key={c.id}
                    className={cx(
                      styles.testLine,
                      c.resultado === "pasa" && styles.pass,
                      c.resultado === "falla" && styles.fail,
                    )}
                  >
                    <span className={styles.ico}>
                      {c.resultado === "pasa" ? "✓" : c.resultado === "falla" ? "✕" : "○"}
                    </span>
                    <span>{JSON.stringify(c.entradas)}</span>
                    <span className={styles.exp}>
                      → esp. {String(c.esperado)} ± {String(c.tolerancia)}
                    </span>
                  </div>
                ))
              )}

              {addOpen ? (
                <div className={styles.fg} style={{ marginTop: 8 }}>
                  <label>Entradas (JSON)</label>
                  <textarea
                    value={addEntradas}
                    onChange={(e) => setAddEntradas(e.target.value)}
                    placeholder='{"edad":60,"peso":70,"crea":1}'
                  />
                  <div className={styles.fg2} style={{ marginTop: 8 }}>
                    <div className={styles.fg}>
                      <label>Esperado</label>
                      <input
                        type="number"
                        step="any"
                        value={addEsperado}
                        onChange={(e) => setAddEsperado(e.target.value)}
                      />
                    </div>
                    <div className={styles.fg}>
                      <label>Tolerancia</label>
                      <input
                        type="number"
                        step="any"
                        value={addTol}
                        onChange={(e) => setAddTol(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className={cx(styles.cta, styles.ctaGhost)}
                      onClick={() => setAddOpen(false)}
                    >
                      Cancelar
                    </button>
                    <button className={styles.cta} onClick={agregar} disabled={agregarCaso.isPending}>
                      Agregar caso
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    className={cx(styles.cta, styles.ctaGhost)}
                    onClick={() => setAddOpen(true)}
                  >
                    + Caso
                  </button>
                  <button
                    className={cx(styles.cta, styles.ctaGhost)}
                    onClick={correr}
                    disabled={total === 0 || correrCasos.isPending}
                  >
                    ▶ Correr casos
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.cardPad}>Cargando definición…</div>
        )}

        <div className={styles.edFoot}>
          <span className={cx(styles.gate, !gateOk && styles.blocked)}>
            {gateOk ? "✓" : "⚠"} {pasan}/{total} casos de prueba correctos
          </span>
          {!yaPublicada ? (
            <label className={styles.valida}>
              <input type="checkbox" checked={valida} onChange={(e) => setValida(e.target.checked)} />
              Validación clínica registrada
            </label>
          ) : (
            <span className={styles.note}>Publicada · editar crea una versión nueva</span>
          )}
          <div className={styles.r}>
            <button className={cx(styles.cta, styles.ctaGhost)} onClick={onClose}>
              Cerrar
            </button>
            {!yaPublicada ? (
              <button
                className={styles.cta}
                onClick={publicarAhora}
                disabled={!gateOk || !valida || publicar.isPending}
                title={
                  !gateOk
                    ? "Publicar bloqueado hasta que todos los casos pasen"
                    : !valida
                      ? "Requiere validación clínica"
                      : undefined
                }
              >
                Publicar versión {calc?.ver ?? ""}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
