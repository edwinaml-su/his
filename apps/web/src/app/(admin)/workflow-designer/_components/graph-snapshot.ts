/**
 * buildGraphSnapshot — construye el `GraphSnapshot` que espera
 * `workflowPublicacion.publish` (y que `rollback` aplica al motor de
 * ejecución) a partir de los estados/transiciones vivos que devuelve
 * `workflowEstado.estado.list` / `workflowEstado.transicion.list`.
 *
 * Contrato 1:1 con `GraphSnapshotSchema` en
 * packages/trpc/src/routers/workflow-publicacion.router.ts — si ese schema
 * cambia, este helper debe actualizarse en el mismo PR.
 *
 * `id` de cada nodo/arista = el id real de `ece.flujo_estado` /
 * `ece.flujo_transicion` (no un id sintético): así el rollback puede
 * hacer upsert por id contra las tablas vivas y converger exactamente.
 */

export interface SnapshotEstadoInput {
  id: string;
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
}

export interface SnapshotTransicionInput {
  id: string;
  estado_origen_id: string;
  estado_destino_id: string;
  accion: string;
  rol_codigo?: string;
  requiere_firma: boolean;
}

export interface GraphSnapshot {
  nodes: Array<{
    id: string;
    nombre: string;
    codigo: string;
    es_inicial: boolean;
    es_final: boolean;
    orden: number;
    posX?: number;
    posY?: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    accion: string;
    rolCodigo?: string;
    requiereFirma?: boolean;
  }>;
}

export function buildGraphSnapshot(
  estados: SnapshotEstadoInput[],
  transiciones: SnapshotTransicionInput[],
  layout?: Record<string, { x: number; y: number }>,
): GraphSnapshot {
  return {
    nodes: estados.map((e) => {
      const pos = layout?.[e.id];
      return {
        id: e.id,
        nombre: e.nombre,
        codigo: e.codigo,
        es_inicial: e.es_inicial,
        es_final: e.es_final,
        orden: e.orden,
        ...(pos ? { posX: pos.x, posY: pos.y } : {}),
      };
    }),
    edges: transiciones.map((t) => ({
      id: t.id,
      source: t.estado_origen_id,
      target: t.estado_destino_id,
      accion: t.accion,
      rolCodigo: t.rol_codigo,
      requiereFirma: t.requiere_firma,
    })),
  };
}
