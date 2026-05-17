/**
 * Validador de integridad de workflows ECE.
 *
 * Función pura — no toca BD. Recibe los arrays de estado, transición y roles
 * ya cargados desde la BD y retorna la lista de errores/warnings.
 *
 * Separar la lógica de validación del router permite:
 * - Tests unitarios sin mocks de Prisma.
 * - Reutilización desde middleware de delete y desde el endpoint validador.
 */

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  message: string;
  severity: ValidationSeverity;
}

/** Shape mínimo que necesita el validator de un estado. */
export interface EstadoInput {
  id: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
}

/** Shape mínimo que necesita el validator de una transición. */
export interface TransicionInput {
  id: string;
  estado_origen_id: string;
  estado_destino_id: string;
  accion: string;
}

/** Shape mínimo para roles funcionales (documento_rol). */
export interface DocumentoRolInput {
  id: string;
}

export interface WorkflowValidatorInput {
  estados: EstadoInput[];
  transiciones: TransicionInput[];
  roles: DocumentoRolInput[];
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

/**
 * Valida la coherencia estructural de un workflow.
 *
 * Reglas de ERROR (bloquean operación):
 *  WF001 — Sin estado inicial
 *  WF002 — Sin estado final
 *  WF003 — Más de un estado inicial
 *  WF004 — Estado intermedio sin transición saliente (deadlock)
 *  WF005 — Estado intermedio sin transición entrante (inalcanzable) — excluye inicial
 *  WF006 — Transición referencia estado inexistente
 *  WF007 — Sin matriz documento_rol definida
 *
 * Reglas de WARNING (informativas):
 *  WF008 — Ninguna transición llega al estado final desde un estado validado
 *  WF009 — Acción duplicada desde el mismo estado origen
 */
export function validateWorkflow(input: WorkflowValidatorInput): WorkflowValidationResult {
  const { estados, transiciones, roles } = input;
  const issues: ValidationIssue[] = [];

  const estadoIds = new Set(estados.map((e) => e.id));

  // ── WF001: sin estado inicial ──────────────────────────────────────────────
  const iniciales = estados.filter((e) => e.es_inicial);
  if (iniciales.length === 0) {
    issues.push({
      code: "WF001",
      message: "Workflow no tiene estado inicial",
      severity: "error",
    });
  }

  // ── WF002: sin estado final ────────────────────────────────────────────────
  const finales = estados.filter((e) => e.es_final);
  if (finales.length === 0) {
    issues.push({
      code: "WF002",
      message: "Workflow no tiene estado final",
      severity: "error",
    });
  }

  // ── WF003: más de un estado inicial ────────────────────────────────────────
  if (iniciales.length > 1) {
    issues.push({
      code: "WF003",
      message: `Solo puede haber 1 estado inicial (encontrados: ${iniciales.map((e) => e.nombre).join(", ")})`,
      severity: "error",
    });
  }

  // ── WF006: transición referencia estado inexistente ─────────────────────────
  // Evaluar antes de WF004/WF005 para evitar falsos deadlocks por refs rotas.
  for (const t of transiciones) {
    if (!estadoIds.has(t.estado_origen_id)) {
      issues.push({
        code: "WF006",
        message: `Transición "${t.accion}" (id: ${t.id}) referencia estado origen eliminado`,
        severity: "error",
      });
    }
    if (!estadoIds.has(t.estado_destino_id)) {
      issues.push({
        code: "WF006",
        message: `Transición "${t.accion}" (id: ${t.id}) referencia estado destino eliminado`,
        severity: "error",
      });
    }
  }

  // Filtrar solo transiciones con referencias válidas para análisis de grafo
  const transicionesValidas = transiciones.filter(
    (t) => estadoIds.has(t.estado_origen_id) && estadoIds.has(t.estado_destino_id),
  );

  const idsConSalida = new Set(transicionesValidas.map((t) => t.estado_origen_id));
  const idsConEntrada = new Set(transicionesValidas.map((t) => t.estado_destino_id));

  // Estados intermedios = ni iniciales ni finales
  const intermedios = estados.filter((e) => !e.es_inicial && !e.es_final);

  // ── WF004: estado intermedio sin salida (deadlock) ──────────────────────────
  for (const e of intermedios) {
    if (!idsConSalida.has(e.id)) {
      issues.push({
        code: "WF004",
        message: `Estado "${e.nombre}" no tiene salida (deadlock)`,
        severity: "error",
      });
    }
  }

  // ── WF005: estado intermedio sin entrada (inalcanzable) ────────────────────
  // El estado inicial puede no tener entrada — es el punto de partida.
  for (const e of intermedios) {
    if (!idsConEntrada.has(e.id)) {
      issues.push({
        code: "WF005",
        message: `Estado "${e.nombre}" no es alcanzable (sin transición entrante)`,
        severity: "error",
      });
    }
  }
  // Los estados finales también deben ser alcanzables (no son iniciales)
  for (const e of finales) {
    if (!idsConEntrada.has(e.id)) {
      issues.push({
        code: "WF005",
        message: `Estado final "${e.nombre}" no es alcanzable (sin transición entrante)`,
        severity: "error",
      });
    }
  }

  // ── WF007: sin roles funcionales ────────────────────────────────────────────
  if (roles.length === 0) {
    issues.push({
      code: "WF007",
      message: "Workflow no tiene roles funcionales definidos (documento_rol vacío)",
      severity: "error",
    });
  }

  // ── WF008: warning — ninguna transición llega al estado final ──────────────
  // Advertencia si hay estados finales pero ninguna transición apunta a alguno.
  if (finales.length > 0) {
    const finalIds = new Set(finales.map((e) => e.id));
    const hayTransicionAFinal = transicionesValidas.some((t) =>
      finalIds.has(t.estado_destino_id),
    );
    if (!hayTransicionAFinal) {
      issues.push({
        code: "WF008",
        message:
          "Considera definir al menos una transición hacia el estado final",
        severity: "warning",
      });
    }
  }

  // ── WF009: warning — acción duplicada desde el mismo origen ────────────────
  const accionPorOrigen = new Map<string, Set<string>>();
  for (const t of transicionesValidas) {
    const key = t.estado_origen_id;
    if (!accionPorOrigen.has(key)) {
      accionPorOrigen.set(key, new Set());
    }
    const acciones = accionPorOrigen.get(key)!;
    if (acciones.has(t.accion)) {
      const origenNombre = estados.find((e) => e.id === key)?.nombre ?? key;
      issues.push({
        code: "WF009",
        message: `Acción duplicada: "${t.accion}" desde el estado "${origenNombre}"`,
        severity: "warning",
      });
    }
    acciones.add(t.accion);
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  return { valid: !hasErrors, errors: issues };
}
