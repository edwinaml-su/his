import { describe, it, expect } from "vitest";
import { buildGraphSnapshot } from "../graph-snapshot";

describe("buildGraphSnapshot", () => {
  it("mapea estados/transiciones vivos al shape de GraphSnapshotSchema", () => {
    const snapshot = buildGraphSnapshot(
      [
        { id: "e1", codigo: "borrador", nombre: "Borrador", es_inicial: true, es_final: false, orden: 1 },
        { id: "e2", codigo: "firmado", nombre: "Firmado", es_inicial: false, es_final: true, orden: 2 },
      ],
      [
        {
          id: "t1",
          estado_origen_id: "e1",
          estado_destino_id: "e2",
          accion: "firmar",
          rol_codigo: "MC",
          requiere_firma: true,
        },
      ],
    );

    expect(snapshot.nodes).toEqual([
      { id: "e1", nombre: "Borrador", codigo: "borrador", es_inicial: true, es_final: false, orden: 1 },
      { id: "e2", nombre: "Firmado", codigo: "firmado", es_inicial: false, es_final: true, orden: 2 },
    ]);
    expect(snapshot.edges).toEqual([
      { id: "t1", source: "e1", target: "e2", accion: "firmar", rolCodigo: "MC", requiereFirma: true },
    ]);
  });

  it("incluye posX/posY solo cuando hay layout para ese estado", () => {
    const snapshot = buildGraphSnapshot(
      [
        { id: "e1", codigo: "borrador", nombre: "Borrador", es_inicial: true, es_final: false, orden: 1 },
        { id: "e2", codigo: "firmado", nombre: "Firmado", es_inicial: false, es_final: true, orden: 2 },
      ],
      [],
      { e1: { x: 10, y: 20 } },
    );

    expect(snapshot.nodes[0]).toMatchObject({ posX: 10, posY: 20 });
    expect(snapshot.nodes[1]).not.toHaveProperty("posX");
    expect(snapshot.nodes[1]).not.toHaveProperty("posY");
  });

  it("estados/transiciones vacíos → snapshot vacío", () => {
    expect(buildGraphSnapshot([], [])).toEqual({ nodes: [], edges: [] });
  });
});
