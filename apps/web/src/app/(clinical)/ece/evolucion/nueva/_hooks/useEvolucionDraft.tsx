"use client";

/**
 * Hook central del draft de evolución médica SOAP.
 *
 * Responsabilidades:
 *   - useReducer sobre DraftState (única fuente de verdad de la UI).
 *   - Autosave a Supabase: lazy-create en el primer cambio con contenido,
 *     update debounced ~1500 ms en cada cambio posterior, y un backstop cada
 *     30 s para capturar tipeo continuo sin pausas (R4.4).
 *   - Demografía del paciente (R3): sexo + edad desde el expediente (no editable),
 *     que alimentan las reglas condicionales por sexo/edad (R2).
 *   - Firmar: flush → firmar → invalidar list → redirect.
 *   - Expone { draft, dispatch, status, savedAt, borradorId, canSign, sign, … }.
 *
 * Decisión: NO usa localStorage — borrador vive en Supabase (CC-0006 §3.2).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import type { AntecedentesEstructurados } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import { calcularEdad } from "../../../../../../lib/evolucion/signos-vitales";
import {
  draftReducer,
  DRAFT_EMPTY,
  puedeFirmar,
  tieneSignos,
  tieneMisc,
  type DraftState,
  type DraftAction,
} from "../_lib/types";

// ─── Tipos del contexto ──────────────────────────────────────────────────────

export type AutosaveStatus =
  | "idle"
  | "guardando"
  | "guardado"
  | { error: string };

/** Contacto de emergencia (CC-0006 §5.3). */
export interface ContactoEmergencia {
  nombre: string;
  parentesco: string;
  telefono: string | null;
}

/** Alergia conocida para el banner del encabezado (CC-0006 §5.1). */
export interface AlergiaResumen {
  substancia: string;
  severidad: string;
}

/** Demografía + encabezado clínico + estado de cuenta del paciente del episodio (R3 / §5). */
export interface PacienteContexto {
  episodioId: string;
  numeroExpediente: string;
  estadoExpediente: string;
  cuentaActiva: boolean;
  nombre: string | null;
  /** 'M' | 'F' | 'I' | 'U' | null */
  sexo: string | null;
  /** ISO date | null */
  fechaNacimiento: string | null;
  // §5 — encabezado clínico sticky
  dui: string | null;
  documentoTipo: string | null;
  /** Nº de cuenta hospitalaria activa (CC-0002); null sin cuenta o sin vínculo HIS. */
  numeroCuenta: string | null;
  domicilio: string | null;
  emergencia: ContactoEmergencia | null;
  alergias: AlergiaResumen[];
  preferredName: string | null;
  esLgbtiq: boolean;
  // §10.3 — snapshot de antecedentes para prefill (o null si el paciente no tiene HC).
  antecedentes: AntecedentesEstructurados | null;
  // §10.3.2 — usuario autenticado para el sello de auditoría de antecedentes negativos.
  usuarioActual: { id: string; nombre: string };
}

interface EvolucionDraftCtx {
  draft: DraftState;
  dispatch: React.Dispatch<DraftAction>;
  status: AutosaveStatus;
  /** Marca de tiempo del último guardado exitoso (R4.4). */
  savedAt: Date | null;
  /** id del borrador una vez creado en BD, undefined si aún no existe */
  borradorId: string | undefined;
  canSign: boolean;
  sign: () => Promise<void>;
  episodeId: string | undefined;
  fecha: Date;
  /** Datos del paciente desde el expediente (R3); null mientras carga o sin episodio. */
  paciente: PacienteContexto | null;
  /** Sexo biológico del paciente ('F' habilita gineco-obstétrico, R2). */
  pacienteSexo: string | null;
  /** Edad en años (alimenta "puede estar embarazada", R2). */
  pacienteEdad: number | null;
  /**
   * R5.1: autocompletado de términos médicos (CIE-11 vía WHO ICD API).
   * Degrada a [] si no hay credenciales. La UI cae a captura manual.
   * Opcional para que los tests puedan mockear el hook sin tRPC.
   */
  buscarTerminos?: (q: string) => Promise<TerminoMedico[]>;
  /**
   * R3: autocompletado de especialidades médicas (catálogo MedicalSpecialty).
   * Degrada a [] ante error. Opcional por la misma razón que buscarTerminos.
   */
  buscarEspecialidades?: (q: string) => Promise<EspecialidadOpcion[]>;
}

/** Sugerencia de término clínico (CIE-11). */
export interface TerminoMedico {
  codigo: string;
  titulo: string;
  uri: string;
}

/** Opción de especialidad médica del catálogo. */
export interface EspecialidadOpcion {
  id: string;
  nombre: string;
}

const Ctx = React.createContext<EvolucionDraftCtx | null>(null);

// ─── Helper: draft con contenido ─────────────────────────────────────────────

function tieneContenido(draft: DraftState): boolean {
  return (
    draft.especialidad.nombre.trim() !== "" ||
    draft.problemas.length > 0 ||
    draft.subjetivo.trim() !== "" ||
    draft.objetivo.trim() !== "" ||
    draft.analisis.trim() !== "" ||
    draft.plan.length > 0 ||
    tieneSignos(draft.signos) ||
    // §11.2: misceláneos capturados deliberadamente también deben autosalvarse.
    // (antecedentes se excluye a propósito: es prefill desde la HC y no debe
    //  disparar la creación del borrador al abrir la página).
    tieneMisc(draft.misc)
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
      // R3: especialidad solo si tiene nombre (el schema exige min(1)).
      especialidad:
        draft.especialidad.nombre.trim() !== "" ? draft.especialidad : undefined,
      problemas: draft.problemas,
      plan: draft.plan,
      signos: tieneSignos(draft.signos) ? draft.signos : undefined,
      // §10.3: snapshot de antecedentes confirmados en esta evolución (round-trip).
      antecedentes: draft.antecedentes,
      // §11.2: misceláneos inline solo si hay contenido (terapia resp. / inyecciones).
      misc: tieneMisc(draft.misc) ? draft.misc : undefined,
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
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [borradorId, setBorradorId] = React.useState<string | undefined>();

  const createMut = trpc.eceEvolucion.create.useMutation();
  const updateMut = trpc.eceEvolucion.update.useMutation();
  const firmarMut = trpc.eceEvolucion.firmar.useMutation();
  const utils = trpc.useUtils();

  // R5.1: búsqueda de términos clínicos (CIE-11). Lazy, on-demand desde
  // MedicalTextarea; degrada a [] si la WHO ICD API no está configurada.
  const buscarTerminos = React.useCallback(
    async (q: string): Promise<TerminoMedico[]> => {
      const term = q.trim();
      if (term.length < 2) return [];
      try {
        const r = await utils.cie11.buscar.fetch({ q: term, limit: 8 });
        return r.configured ? r.items : [];
      } catch {
        return [];
      }
    },
    [utils],
  );

  // R3: búsqueda de especialidades médicas (catálogo). Lazy desde EspecialidadCard.
  const buscarEspecialidades = React.useCallback(
    async (q: string): Promise<EspecialidadOpcion[]> => {
      try {
        const rows = (await utils.catalog.list.fetch({
          catalog: "medicalSpecialty",
          activeOnly: true,
          search: q.trim() || undefined,
        })) as Array<{ id: string; name: string }>;
        return rows.map((r) => ({ id: r.id, nombre: r.name }));
      } catch {
        return [];
      }
    },
    [utils],
  );

  // R3: demografía del paciente desde el expediente (sexo/edad → reglas R2).
  const contextoQuery = trpc.eceEvolucion.contextoPaciente.useQuery(
    { episodioId: episodeId ?? "" },
    { enabled: !!episodeId, staleTime: 5 * 60 * 1000 },
  );
  const paciente: PacienteContexto | null = contextoQuery.data ?? null;
  const pacienteSexo = paciente?.sexo ?? null;
  const pacienteEdad = calcularEdad(paciente?.fechaNacimiento ?? null);

  // §10.3: prefill (una sola vez) del snapshot de antecedentes desde la HC
  // canónica. No dispara autosave porque tieneContenido excluye antecedentes.
  const antecedentesPrefilledRef = React.useRef(false);
  React.useEffect(() => {
    if (antecedentesPrefilledRef.current) return;
    const ant = contextoQuery.data?.antecedentes;
    if (ant) {
      antecedentesPrefilledRef.current = true;
      dispatch({ type: "SET_ANTECEDENTES", antecedentes: ant });
    }
  }, [contextoQuery.data]);

  // Guard para StrictMode: evita doble-create en el primer cambio
  const creatingRef = React.useRef(false);
  const borradorIdRef = React.useRef<string | undefined>();

  // Ref al debounce timer
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref al draft actual para el flush síncrono previo a firmar
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  // Cambios sin persistir (lo limpia cada save exitoso; lo levanta cada cambio).
  const dirtyRef = React.useRef(false);
  // Ref al update pendiente para flush
  const pendingUpdateRef = React.useRef<Promise<void> | null>(null);

  // ── Persistencia compartida (create lazy o update) ─────────────────────────

  async function flush(): Promise<void> {
    if (!episodeId) return;
    if (!tieneContenido(draftRef.current)) return;
    const soap = buildSoap(draftRef.current);

    if (!borradorIdRef.current) {
      // Lazy-create — solo una vez
      if (creatingRef.current) return;
      creatingRef.current = true;
      setStatus("guardando");
      try {
        const r = (await createMut.mutateAsync({
          episodioId: episodeId,
          fecha,
          ...soap,
        })) as { id: string };
        borradorIdRef.current = r.id;
        setBorradorId(r.id);
        dirtyRef.current = false;
        setStatus("guardado");
        setSavedAt(new Date());
      } catch (e) {
        setStatus({ error: e instanceof Error ? e.message : "Error al crear borrador" });
      } finally {
        creatingRef.current = false;
      }
    } else {
      const id = borradorIdRef.current;
      setStatus("guardando");
      const p = updateMut
        .mutateAsync({ id, ...soap })
        .then(() => {
          dirtyRef.current = false;
          setStatus("guardado");
          setSavedAt(new Date());
        })
        .catch((e: unknown) => {
          setStatus({ error: e instanceof Error ? e.message : "Error al guardar" });
        });
      pendingUpdateRef.current = p;
      await p;
      pendingUpdateRef.current = null;
    }
  }

  // Ref a la última versión de flush para los timers (evita closures stale).
  const flushRef = React.useRef(flush);
  flushRef.current = flush;

  // ── Autosave debounced (~1.5 s tras cada cambio) ───────────────────────────

  React.useEffect(() => {
    if (!episodeId) return;
    if (!tieneContenido(draft)) return;

    dirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void flushRef.current();
    }, 1500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, episodeId]);

  // ── Backstop cada 30 s (R4.4): flush si hay cambios sin guardar ────────────

  React.useEffect(() => {
    if (!episodeId) return;
    const t = setInterval(() => {
      if (dirtyRef.current) void flushRef.current();
    }, 30_000);
    return () => clearInterval(t);
  }, [episodeId]);

  // ── Firmar ────────────────────────────────────────────────────────────────

  async function sign() {
    if (!episodeId) return;

    // Flush: cancelar debounce, esperar update pendiente y forzar uno final.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pendingUpdateRef.current) {
      await pendingUpdateRef.current;
    }
    await flush();

    const id = borradorIdRef.current;
    if (!id) {
      setStatus({ error: "No se pudo preparar el borrador para firmar." });
      return;
    }

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
    savedAt,
    borradorId,
    canSign: puedeFirmar(draft),
    sign,
    episodeId,
    fecha,
    paciente,
    pacienteSexo,
    pacienteEdad,
    buscarTerminos,
    buscarEspecialidades,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ─── Hook de acceso ──────────────────────────────────────────────────────────

export function useEvolucionDraft(): EvolucionDraftCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useEvolucionDraft debe usarse dentro de EvolucionDraftProvider");
  return ctx;
}
