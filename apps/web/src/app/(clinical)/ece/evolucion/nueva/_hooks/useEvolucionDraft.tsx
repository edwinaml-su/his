"use client";

/**
 * Hook central del draft de evolución médica SOAP.
 *
 * Responsabilidades:
 *   - useReducer sobre DraftState (única fuente de verdad de la UI).
 *   - Autosave a Supabase: lazy-create en el primer cambio con contenido,
 *     update debounced ~1500 ms en cada cambio posterior.
 *   - Firmar: flush → firmar → invalidar list → redirect.
 *   - Expone { draft, dispatch, status, borradorId, canSign, sign }.
 *
 * Decisión: NO usa localStorage — borrador vive en Supabase (CC-0006 §3.2).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/react";
import {
  draftReducer,
  DRAFT_EMPTY,
  puedeFirmar,
  tieneSignos,
  type DraftState,
  type DraftAction,
} from "../_lib/types";

// ─── Tipos del contexto ──────────────────────────────────────────────────────

export type AutosaveStatus =
  | "idle"
  | "guardando"
  | "guardado"
  | { error: string };

interface EvolucionDraftCtx {
  draft: DraftState;
  dispatch: React.Dispatch<DraftAction>;
  status: AutosaveStatus;
  /** id del borrador una vez creado en BD, undefined si aún no existe */
  borradorId: string | undefined;
  canSign: boolean;
  sign: () => Promise<void>;
  episodeId: string | undefined;
  fecha: Date;
}

const Ctx = React.createContext<EvolucionDraftCtx | null>(null);

// ─── Helper: draft con contenido ─────────────────────────────────────────────

function tieneContenido(draft: DraftState): boolean {
  return (
    draft.problemas.length > 0 ||
    draft.subjetivo.trim() !== "" ||
    draft.objetivo.trim() !== "" ||
    draft.analisis.trim() !== "" ||
    draft.plan.length > 0 ||
    tieneSignos(draft.signos)
  );
}

// ─── Helper: construir payload SOAP ──────────────────────────────────────────

function buildSoap(draft: DraftState) {
  const planTexto = draft.plan
    .map((it, i) => `${i + 1}. ${it.texto}`)
    .join("\n");

  return {
    soapSubjetivo: draft.subjetivo.trim(),
    soapObjetivo: draft.objetivo.trim(),
    soapAnalisis: draft.analisis.trim(),
    soapPlan: planTexto,
    data: {
      problemas: draft.problemas,
      plan: draft.plan,
      signos: tieneSignos(draft.signos) ? draft.signos : undefined,
    },
  };
}

// ─── Provider ────────────────────────────────────────────────────────────────

interface Props {
  episodeId: string | undefined;
  children: React.ReactNode;
}

export function EvolucionDraftProvider({ episodeId, children }: Props) {
  const router = useRouter();
  const fecha = React.useRef(new Date()).current;

  const [draft, dispatch] = React.useReducer(draftReducer, DRAFT_EMPTY);
  const [status, setStatus] = React.useState<AutosaveStatus>("idle");
  const [borradorId, setBorradorId] = React.useState<string | undefined>();

  const createMut = trpc.eceEvolucion.create.useMutation();
  const updateMut = trpc.eceEvolucion.update.useMutation();
  const firmarMut = trpc.eceEvolucion.firmar.useMutation();
  const utils = trpc.useUtils();

  // Guard para StrictMode: evita doble-create en el primer cambio
  const creatingRef = React.useRef(false);
  const borradorIdRef = React.useRef<string | undefined>();

  // Ref al debounce timer
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref al draft actual para el flush síncrono previo a firmar
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  // Ref al update pendiente para flush
  const pendingUpdateRef = React.useRef<Promise<void> | null>(null);

  // ── Efecto de autosave ─────────────────────────────────────────────────────

  React.useEffect(() => {
    // Sin episodioId → autosave deshabilitado
    if (!episodeId) return;
    if (!tieneContenido(draft)) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const soap = buildSoap(draftRef.current);

      if (!borradorIdRef.current) {
        // Lazy-create — solo una vez
        if (creatingRef.current) return;
        creatingRef.current = true;
        setStatus("guardando");
        try {
          const r = await createMut.mutateAsync({
            episodioId: episodeId,
            fecha,
            ...soap,
          }) as { id: string };
          borradorIdRef.current = r.id;
          setBorradorId(r.id);
          setStatus("guardado");
        } catch (e) {
          setStatus({ error: e instanceof Error ? e.message : "Error al crear borrador" });
        } finally {
          creatingRef.current = false;
        }
      } else {
        // Update
        const id = borradorIdRef.current;
        setStatus("guardando");
        const p = updateMut
          .mutateAsync({ id, ...soap })
          .then(() => {
            setStatus("guardado");
          })
          .catch((e: unknown) => {
            setStatus({ error: e instanceof Error ? e.message : "Error al guardar" });
          });
        pendingUpdateRef.current = p;
        await p;
        pendingUpdateRef.current = null;
      }
    }, 1500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, episodeId]);

  // ── Firmar ────────────────────────────────────────────────────────────────

  async function sign() {
    if (!episodeId) return;

    // Flush: esperar update pendiente o forzar uno final
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (pendingUpdateRef.current) {
      await pendingUpdateRef.current;
    }

    let id = borradorIdRef.current;

    // Si aún no existe borrador, créalo ahora
    if (!id) {
      setStatus("guardando");
      try {
        const r = await createMut.mutateAsync({
          episodioId: episodeId,
          fecha,
          ...buildSoap(draftRef.current),
        }) as { id: string };
        id = r.id;
        borradorIdRef.current = r.id;
        setBorradorId(r.id);
      } catch (e) {
        setStatus({ error: e instanceof Error ? e.message : "Error al crear antes de firmar" });
        return;
      }
    } else {
      // Update final antes de firmar
      setStatus("guardando");
      try {
        await updateMut.mutateAsync({ id, ...buildSoap(draftRef.current) });
      } catch {
        // No bloqueante — continuar con firmar de todas formas
      }
    }

    // En este punto id siempre está asignado (créado arriba o venía del else)
    if (!id) return;

    try {
      await firmarMut.mutateAsync({ id });
      await utils.eceEvolucion.list.invalidate({ episodioId: episodeId });
      router.replace(`/ece/evolucion/${id}`);
    } catch (e) {
      setStatus({ error: e instanceof Error ? e.message : "Error al firmar" });
    }
  }

  const value: EvolucionDraftCtx = {
    draft,
    dispatch,
    status,
    borradorId,
    canSign: puedeFirmar(draft),
    sign,
    episodeId,
    fecha,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ─── Hook de acceso ──────────────────────────────────────────────────────────

export function useEvolucionDraft(): EvolucionDraftCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useEvolucionDraft debe usarse dentro de EvolucionDraftProvider");
  return ctx;
}
