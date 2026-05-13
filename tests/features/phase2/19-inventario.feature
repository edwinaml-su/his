# language: es
# Épica: E19 — Inventario y Almacén
# TDR: §19 Insumos y Almacén Hospitalario
# Stack backend: inventoryRouter (skeleton Wave 8)
# Persona principal: P10 — Bodeguero / P7 — Farmacéutico
# Valor: Catálogo de insumos, lotes con vencimiento y movimientos inmutables.

@phase2 @inventory @es-SV
Característica: Gestión de inventario con lotes y movimientos
  Como bodeguero o farmacéutico (P7, P10)
  Quiero registrar items, lotes y movimientos de inventario
  Para tener trazabilidad de stock con vencimientos por establecimiento.

  Antecedentes:
    Dado un item "Guantes estériles talla M" en el catálogo del tenant
    Y un establecimiento "Bodega Central" activo

  @smoke @happy
  Escenario: Registrar un movimiento de entrada con lote
    Dado un lote del item con fecha de vencimiento futura
    Cuando registro un movimiento tipo "IN" de 200 unidades en "Bodega Central"
    Y referencio el lote correspondiente
    Entonces el movimiento queda registrado con su organizationId
    Y queda asociado al lote y al establecimiento

  @edge @tenant-isolation
  Escenario: No permitir movimientos contra lotes de otra organización
    Dado un lote registrado en la organización "OrgA"
    Cuando un usuario autenticado en la organización "OrgB" intenta registrar un movimiento sobre ese lote
    Entonces el sistema responde "no encontrado"
    Y el movimiento no se crea
