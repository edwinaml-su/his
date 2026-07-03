"use client";

/**
 * PantallasModal — modal de visibilidad por pantalla para una calculadora
 * (CC-0009, `pg-scrim` del mockup). Escenifica el scope y persiste vía
 * `calculadoras.setPaginas` al guardar.
 */
import * as React from "react";
import { trpc } from "@/lib/trpc/react";
import { cx } from "@/components/calculadoras/calc-shared";
import styles from "./calc-admin.module.css";
import { PantallaGrid, type PaginasScope, type PantallaItem } from "./pantalla-grid";

export function PantallasModal({
  calcId,
  codigo,
  nombre,
  scope,
  pantallas,
  onClose,
  onSaved,
  onToast,
}: {
  calcId: string;
  codigo: string;
  nombre: string;
  scope: PaginasScope;
  pantallas: PantallaItem[];
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string) => void;
}) {
  const [draft, setDraft] = React.useState<PaginasScope>(scope);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const setPaginas = trpc.calculadoras.setPaginas.useMutation();

  function guardar() {
    setPaginas.mutate(
      { id: calcId, paginas: draft },
      {
        onSuccess: () => {
          onSaved();
          onToast(`Pantallas actualizadas: ${nombre}`);
          onClose();
        },
        onError: (e) => onToast(e.message),
      },
    );
  }

  return (
    <div
      className={cx(styles.vars, styles.pgScrim, shown && styles.show)}
      role="dialog"
      aria-modal="true"
      aria-label={`Visibilidad por pantalla · ${nombre}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.pgbox}>
        <div className={styles.edHead}>
          <h3>Visibilidad por pantalla</h3>
          <span className={cx(styles.chip, styles.formula)}>{codigo}</span>
          <button className={styles.x} onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className={styles.pgboxBody}>
          <p className={styles.pgSub}>
            Define en qué pantallas del expediente aparece <b>{nombre}</b> dentro de la barra
            flotante del médico. Desactiva “todas” para elegir pantallas específicas.
          </p>
          <PantallaGrid value={draft} pantallas={pantallas} onChange={setDraft} />
        </div>
        <div className={styles.edFoot}>
          <span className={styles.note}>Los cambios aplican a la barra flotante del médico</span>
          <div className={styles.r}>
            <button className={cx(styles.cta, styles.ctaGhost)} onClick={onClose}>
              Cancelar
            </button>
            <button className={styles.cta} onClick={guardar} disabled={setPaginas.isPending}>
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
