# ADR 0024 — Contrato transaccional admisión ↔ episodio ECE (P0-4)

- **Estado:** ACEPTADO — decisión de Edwin (dirección) 2026-09-09: **fail-fast**.
- **Contexto:** hallazgo P0-4 del assessment Code Castle: `lib/ece-hooks.ts`
  documentaba «nunca lanzan — los errores se loguean y el caller continúa», y
  `encounter.admit` creaba el episodio ECE en una transacción separada con
  `catch` silencioso. Resultado posible: admisiones confirmadas SIN expediente
  NTEC, en silencio (los 31 tipos de documento dependen del episodio).
- **Decisión:** la admisión y su episodio ECE son **atómicos**. El hook corre
  dentro de la misma transacción de `encounter.admit`; cualquier fallo
  (establecimiento sin espejo ECE, paciente sin expediente creable, error SQL)
  revierte la admisión con `PRECONDITION_FAILED` accionable. Excepción
  BIRTH/NEWBORN (atencion-rn.router crea sus propias filas ece.*).
- **Alternativa descartada:** outbox compensatorio — más resiliente a caídas
  de ECE pero introduce una ventana sin expediente y maquinaria adicional;
  pre-go-live el error ruidoso vale más que la disponibilidad parcial.
- **Alcance colateral cerrado en el mismo cambio:** desde SQL 217 (ADR 0022)
  la FK de `ece.paciente.establecimiento_id` apunta a `ece.establecimiento`;
  `hookEcePacienteAfterCreate` seguía insertando el id de
  `public."Establishment"` → violación de FK en toda alta de paciente nueva,
  silenciada por el non-fatal. El hook ahora resuelve el puente internamente
  (tolerante a ambos espacios, mismo criterio que `ece.set_ece_context`).
- **El alta de Patient** (fuera de una admisión) sigue siendo tolerante en su
  caller (backfillable con `scripts/backfill-ece.mjs`) — el contrato duro es
  de la ADMISIÓN.
