"use client";

/**
 * Catálogo de calculadoras clínicas — administración (CC-0009 / ECE-CALC-001).
 *
 * Vista de Farmacia Clínica / Calidad, fiel al mockup
 * docs/CC/0009/calculadoras-clinicas.html (vista admin): versionado inmutable,
 * activación por país (SV), visibilidad por pantalla y gate de publicación
 * (casos de prueba en verde + validación clínica). Requiere rol ADMIN/DIR/PHARM
 * (el router rechaza a quien no lo tenga; aquí se muestra estado vacío/errores).
 */
import * as React from "react";
import { trpc } from "@/lib/trpc/react";
import { cx, tagGlyph } from "@/components/calculadoras/calc-shared";
import styles from "./calc-admin.module.css";
import {
  PantallaGrid,
  pagLabel,
  pagPillClass,
  type PaginasScope,
  type PantallaItem,
} from "./pantalla-grid";
import { PantallasModal } from "./pantallas-modal";
import { GestionModal } from "./gestion-modal";

type Filtro = "todas" | "formula" | "score" | "dosis" | "hr";

interface Row {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  categoria: string;
  altoRiesgo: boolean;
  sub: string | null;
  estado: string;
  paises: unknown;
  paginas: unknown;
  versionActual: number | null;
  totalVersiones: number;
}

const ESTADO_META: Record<string, { cls: "pub" | "draft" | "retired"; label: string }> = {
  publicada: { cls: "pub", label: "Publicada" },
  borrador: { cls: "draft", label: "Borrador" },
  retirada: { cls: "retired", label: "Retirada" },
};
const ESTADO_FALLBACK = { cls: "draft", label: "Borrador" } as const;

const TIPO_LABEL: Record<string, string> = {
  formula: "FÓRMULA",
  score: "SCORE",
  dosis: "DOSIS",
  nativo: "NATIVA",
};

function paisesDe(v: unknown): { SV: boolean; GT: boolean; HN: boolean } {
  const p = (v ?? {}) as Record<string, boolean>;
  return { SV: Boolean(p.SV), GT: Boolean(p.GT), HN: Boolean(p.HN) };
}
function scopeDe(v: unknown): PaginasScope {
  return v === "*" || v === undefined || v === null ? "*" : (v as string[]);
}

export default function CalculadorasAdminPage() {
  const [filtro, setFiltro] = React.useState<Filtro>("todas");
  const [cfgId, setCfgId] = React.useState<string>("");
  const [pantallasModal, setPantallasModal] = React.useState<Row | null>(null);
  const [gestionId, setGestionId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ msg: string; shown: boolean }>({ msg: "", shown: false });
  const toastTimer = React.useRef<ReturnType<typeof setTimeout>>();

  const utils = trpc.useUtils();
  const listQuery = trpc.calculadoras.list.useQuery({});
  const pantallasQuery = trpc.calculadoras.pantallas.useQuery();
  const setPaises = trpc.calculadoras.setPaises.useMutation();
  const setPaginas = trpc.calculadoras.setPaginas.useMutation();

  const rows = React.useMemo(() => (listQuery.data ?? []) as Row[], [listQuery.data]);
  const pantallas: PantallaItem[] = (pantallasQuery.data ?? []).map((p) => ({
    id: p.id,
    etiqueta: p.etiqueta,
  }));

  function showToast(msg: string) {
    setToast({ msg, shown: true });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, shown: false })), 2600);
  }
  function refetchList() {
    void utils.calculadoras.list.invalidate();
  }

  const filtradas = rows.filter((r) => {
    if (filtro === "todas") return true;
    if (filtro === "hr") return r.altoRiesgo;
    return r.tipo === filtro;
  });

  // Calculadora seleccionada en el panel inline de visibilidad.
  const cfgRow = rows.find((r) => r.id === cfgId) ?? rows[0];
  React.useEffect(() => {
    const first = rows[0];
    if (!cfgId && first) setCfgId(first.id);
  }, [rows, cfgId]);

  // Eco optimista del scope de pantallas del panel inline. Sin este estado local
  // el toggle "revertía" visualmente (leía server state) hasta que la lista
  // refrescaba, y las chips quedaban deshabilitadas en ese lapso: se percibía
  // como que la asignación no guardaba. Se re-sincroniza al cambiar de
  // calculadora o cuando el servidor confirma un valor nuevo.
  const cfgScopeServidor: PaginasScope = cfgRow ? scopeDe(cfgRow.paginas) : "*";
  const cfgSyncKey = `${cfgRow?.id ?? ""}|${JSON.stringify(cfgScopeServidor)}`;
  const [cfgScope, setCfgScope] = React.useState<PaginasScope>(cfgScopeServidor);
  React.useEffect(() => {
    setCfgScope(cfgScopeServidor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgSyncKey]);

  function togglePais(r: Row) {
    const cur = paisesDe(r.paises);
    setPaises.mutate(
      { id: r.id, paises: { SV: !cur.SV } },
      {
        onSuccess: (res) => {
          refetchList();
          showToast(res.paises.SV ? `Activada en SV: ${r.nombre}` : `Retirada de SV: ${r.nombre}`);
        },
        onError: (e) => showToast(e.message),
      },
    );
  }

  function guardarCfgPantallas(scope: PaginasScope) {
    if (!cfgRow) return;
    setCfgScope(scope); // eco optimista: refleja el cambio al instante
    setPaginas.mutate(
      { id: cfgRow.id, paginas: scope },
      {
        onSuccess: () => refetchList(),
        onError: (e) => {
          setCfgScope(cfgScopeServidor); // revertir al último valor confirmado
          showToast(e.message);
        },
      },
    );
  }

  const totalPub = rows.filter((r) => r.estado === "publicada").length;

  return (
    <div className={styles.vars}>
      <div className={styles.hEyebrow}>Administración · Farmacia Clínica / Calidad</div>
      <h1 className={styles.hTitle}>Catálogo de fórmulas</h1>
      <p className={styles.hSub}>
        Cada fórmula publicada es inmutable: editar crea una versión nueva. Los cálculos
        históricos conservan la versión con la que se realizaron. Aquí se define qué aparece en la
        barra flotante del médico y en qué país.{" "}
        <b>
          Biblioteca inicial de {rows.length || 205} calculadoras; cada una requiere validación
          clínica antes de habilitarse en producción.
        </b>
      </p>

      {/* ===== Visibilidad por pantalla (inline) ===== */}
      <div className={cx(styles.card, styles.cardTop)}>
        <div className={styles.cardH}>
          <div>
            <h3>Visibilidad por pantalla</h3>
            <div className={styles.sub}>
              Configura en qué pantallas del expediente aparece cada calculadora dentro de la barra
              flotante del médico.
            </div>
          </div>
        </div>
        <div className={styles.cardPad}>
          <div className={cx(styles.fg, styles.fgWide)}>
            <label htmlFor="cfg-calc">Calculadora</label>
            <select id="cfg-calc" value={cfgRow?.id ?? ""} onChange={(e) => setCfgId(e.target.value)}>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.codigo} · {r.nombre}
                </option>
              ))}
            </select>
          </div>
          {cfgRow ? (
            <div style={{ marginTop: 16 }}>
              <PantallaGrid
                value={cfgScope}
                pantallas={pantallas}
                onChange={guardarCfgPantallas}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* ===== Fórmulas registradas ===== */}
      <div className={cx(styles.card, styles.cardTop)}>
        <div className={styles.cardH}>
          <div>
            <h3>Fórmulas registradas</h3>
            <div className={styles.sub}>
              {rows.length} fórmulas · {totalPub} publicadas · país activo: El Salvador (SV)
            </div>
          </div>
          <div className={styles.r}>
            <button
              className={cx(styles.cta, styles.ctaGhost)}
              onClick={() => showToast("Importación desde plantilla / API (v1: biblioteca semilla)")}
            >
              ↧ Importar
            </button>
            <button
              className={styles.cta}
              onClick={() => showToast("Autoría de nuevas fórmulas vía catálogo semilla / API (v1)")}
            >
              + Nueva fórmula
            </button>
          </div>
        </div>

        <div className={styles.filterbar}>
          {(
            [
              ["todas", "Todas"],
              ["formula", "Fórmula"],
              ["score", "Score"],
              ["dosis", "Dosis"],
              ["hr", "Alto riesgo"],
            ] as [Filtro, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              className={cx(styles.fchip, filtro === k && styles.on)}
              onClick={() => setFiltro(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.tblWrap}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Fórmula</th>
                <th>Tipo</th>
                <th>Versión</th>
                <th>Estado</th>
                <th>Activación país</th>
                <th className={styles.center}>En barra</th>
                <th className={styles.center}>Pantallas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r) => {
                const paises = paisesDe(r.paises);
                const scope = scopeDe(r.paginas);
                const est = ESTADO_META[r.estado] ?? ESTADO_FALLBACK;
                return (
                  <tr key={r.id}>
                    <td className={styles.codeC}>{r.codigo}</td>
                    <td className={styles.nmC}>
                      <b>{r.nombre}</b>
                      <span>{r.categoria}</span>
                    </td>
                    <td>
                      <span
                        className={cx(
                          styles.chip,
                          styles[r.tipo as "formula" | "score" | "dosis" | "nativo"],
                        )}
                      >
                        {tagGlyph(r.tipo as "formula" | "score" | "dosis" | "nativo")}{" "}
                        {TIPO_LABEL[r.tipo]}
                      </span>
                      {r.altoRiesgo ? <span className={cx(styles.chip, styles.hr)}>ALTO RIESGO</span> : null}
                    </td>
                    <td>
                      <span className={styles.vpill}>v{r.versionActual ?? r.totalVersiones}</span>
                    </td>
                    <td>
                      <span className={cx(styles.state, styles[est.cls])}>
                        <span className={styles.d} />
                        {est.label}
                      </span>
                    </td>
                    <td>
                      <div className={styles.flags}>
                        {(["SV", "GT", "HN"] as const).map((k) => (
                          <span key={k} className={cx(styles.flag, paises[k] && styles.act)}>
                            {k}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={styles.center}>
                      <button
                        type="button"
                        className={cx(styles.sw, styles.swCenter, paises.SV && styles.on)}
                        role="switch"
                        aria-checked={paises.SV}
                        aria-label={`Activar en SV: ${r.nombre}`}
                        onClick={() => togglePais(r)}
                      />
                    </td>
                    <td className={styles.center}>
                      <button
                        className={cx(styles.pgpill, styles[pagPillClass(scope)])}
                        onClick={() => setPantallasModal(r)}
                        title="Configurar en qué pantallas aparece"
                      >
                        {pagLabel(scope)}
                      </button>
                    </td>
                    <td>
                      <div className={styles.rowAct}>
                        <button title="Gestionar / publicar" onClick={() => setGestionId(r.id)}>
                          ✎
                        </button>
                        <button
                          title="Historial de versiones"
                          onClick={() => showToast(`${r.totalVersiones} versión(es) · ${r.codigo}`)}
                        >
                          ⟲
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {listQuery.isLoading ? (
            <div className={styles.empty}>Cargando catálogo…</div>
          ) : listQuery.error ? (
            <div className={styles.empty}>
              No se pudo cargar el catálogo. Requiere rol ADMIN, DIR o PHARM.
            </div>
          ) : filtradas.length === 0 ? (
            <div className={styles.empty}>Sin fórmulas para este filtro.</div>
          ) : null}
        </div>
      </div>

      {pantallasModal ? (
        <PantallasModal
          calcId={pantallasModal.id}
          codigo={pantallasModal.codigo}
          nombre={pantallasModal.nombre}
          scope={scopeDe(pantallasModal.paginas)}
          pantallas={pantallas}
          onClose={() => setPantallasModal(null)}
          onSaved={refetchList}
          onToast={showToast}
        />
      ) : null}

      {gestionId ? (
        <GestionModal
          calcId={gestionId}
          pantallas={pantallas}
          onClose={() => setGestionId(null)}
          onChanged={refetchList}
          onToast={showToast}
        />
      ) : null}

      <div className={cx(styles.toast, toast.shown && styles.show)}>
        <span className={styles.ic}>✓</span>
        <span>{toast.msg}</span>
      </div>
    </div>
  );
}
