/**
 * IDs deterministas sembrados por packages/database/scripts/seed-e2e-fixtures.mjs
 * en la BD efímera de CI (paso "Seed fixtures clínicos E2E" de e2e.yml /
 * e2e-smoke.yml). Si cambiás un id allá, actualizá este archivo en el mismo
 * commit — son la misma constante en dos runtimes distintos (.mjs vs .ts).
 */
export const E2E_FIXTURES = {
  /** Paciente María Pérez (public."Patient" y ece.paciente comparten id). */
  patientId: "e2ef1000-0000-4000-8000-000000000001",
  /** Encounter abierto (dischargedAt NULL) — visible en /transfers. */
  encounterId: "e2ef1000-0000-4000-8000-000000000002",
  /** Cama E2E-01 en estado FREE (HOSP). */
  bedFreeId: "e2ef1000-0000-4000-8000-0000000000b1",
  /** Cama E2E-02 OCCUPIED — con BedAssignment y ece.asignacion_cama activas. */
  bedOccupiedId: "e2ef1000-0000-4000-8000-0000000000b2",
  /** Episodio hospitalario ECE del paciente ocupando E2E-02. */
  episodioHospitalarioId: "e2ef1000-0000-4000-8000-00000000e904",
  /** encounterNumber sigue el patrón ENC-{AAAA}-000101 (año UTC del seed). */
  encounterNumberPattern: /ENC-\d{4}-\d{6}/,
  /**
   * Indicación médica firmada (ece.indicaciones_medicas) con un item
   * MEDICAMENTO (Amoxicilina 500mg IV cada 8h) — alimenta /bedside y el
   * wizard /bedside/[patientId]/[indicationId] (bedside-hard-stops.spec.ts).
   */
  indicationId: "e2ef1000-0000-4000-8000-00000000e907",
} as const;

/**
 * Valores GS1 sembrados por packages/database/scripts/seed-e2e-fixtures.mjs
 * (§4 "GS1 escaneable") — mismos literales, no recalculados. Usados por
 * bedside-hard-stops.spec.ts para simular escaneos de pulsera/badge/DataMatrix.
 */
export const E2E_GS1 = {
  /** GSRN-18 de la pulsera de María Pérez (E2E_FIXTURES.patientId). */
  gsrnPaciente: "801874130000000011",
  /** GSRN-18 del badge de la enfermera QA (activo). */
  gsrnEnfermera: "801874130000010010",
  /** GSRN-18 de un badge de enfermera revocado (activo=false). */
  gsrnEnfermeraRevocada: "801874130000010089",
  /** GTIN-14 de Amoxicilina 500mg — coincide con el item de la indicación. */
  gtinAmoxicilina500: "07501000001231",
  /** GTIN-14 de Ibuprofeno 400mg — NO coincide con la indicación (hard-stop). */
  gtinIbuprofeno400: "07501000009992",
  /**
   * GSRN-18 (formato válido, 18 dígitos) que nunca fue sembrado en
   * ece.gs1_gsrn — bedside.router.ts no valida checksum GS1, solo
   * existencia/activo en el catálogo, así que basta con que no exista fila.
   */
  gsrnPacienteNoRegistrado: "801874130000099993",
} as const;

/**
 * RN-HIS-BOT-001 (docs/48 C5-2) — ids/GTIN/códigos sembrados por
 * packages/database/scripts/seed-e2e-fixtures.mjs §7. Mismo namespace
 * e2ef2000 en ambos archivos (helper `botId` duplicado a propósito — un
 * archivo .mjs de Node y uno .ts de Playwright no comparten runtime, no
 * vale la pena un paquete compartido para una función de 1 línea). Si
 * cambiás un id/GTIN/código allá, actualizá esta tabla en el mismo commit.
 */
function botId(escena: number, rol: string): string {
  return `e2ef2000-0000-4000-8000-000000000${escena}${rol}`;
}

interface BotScenario {
  /** public."Patient".id */
  patientId: string;
  /** public."PatientAccount".id */
  accountId: string;
  /** public."Prescription".id — también el `pharmacyOrderId` de /pharmacy/dispense/[orderId]. */
  prescriptionId: string;
  /** code del tarifario (ServicePriceListItem.code / ServicePriceRule.itemCode / StockItem.sku). */
  code: string;
  /** GTIN-14 con checksum GS1 válido (StockItem.gtin). */
  gtin: string;
  /** StockLot.lotNumber — qty sembrada 20, alcanza para 2+ dispensaciones por escenario. */
  lote: string;
  /** public."Drug".genericName — el <select> de medicamento lo muestra como texto. */
  drugName: string;
}

function scenario(escena: number, code: string, gtin: string, lote: string, drugName: string): BotScenario {
  return {
    patientId: botId(escena, "01"),
    accountId: botId(escena, "02"),
    prescriptionId: botId(escena, "04"),
    code,
    gtin,
    lote,
    drugName,
  };
}

export const E2E_BOT = {
  /** Prueba #1 — ISBM: precio via ServicePriceRule (camino "regla" del resolver), $12.50. */
  isbm: scenario(1, "BOT-E2E-ISBM", "07501000020010", "LOTE-E2E-ISBM-01", "Botiquín E2E — ISBM"),
  /** Prueba #2 — MAPFRE: precio via ServicePriceListItem plano (camino "lista"), $18.75. */
  mapfre: scenario(2, "BOT-E2E-MAPFRE", "07501000030019", "LOTE-E2E-MAPFRE-01", "Botiquín E2E — MAPFRE"),
  /** Prueba #3 — DoctorSV: tipo de cuenta permitido + tarifa resuelta, $9.99. */
  doctorsv: scenario(3, "BOT-E2E-DOCTORSV", "07501000040018", "LOTE-E2E-DOCTORSV-01", "Botiquín E2E — DoctorSV"),
  /** Prueba #4 — código sin precio en ninguna lista (ni default) ⇒ PENDIENTE_TARIFA. */
  sinPrecio: scenario(4, "BOT-E2E-SINPRECIO", "07501000050017", "LOTE-E2E-SINPRECIO-01", "Botiquín E2E — Sin Precio"),
  /** Prueba #6 — devolución: MAPFRE $7.25, dispensar y luego cancelar la reserva. */
  devolucion: scenario(5, "BOT-E2E-DEVOLUCION", "07501000060016", "LOTE-E2E-DEVOLUCION-01", "Botiquín E2E — Devolución"),
  /** Prueba #7 — cuenta PENDIENTE_REGULARIZAR (emergencia sin pagador), lista default $5.00. */
  emergencia: scenario(6, "BOT-E2E-EMERGENCIA", "07501000070015", "LOTE-E2E-EMERGENCIA-01", "Botiquín E2E — Emergencia"),
  /** Prueba #8 — regla ISBM inicial $15.00 (dateStart=ayer); el spec agrega una 2ª regla "hoy". */
  tarifaHoy: scenario(7, "BOT-E2E-TARIFAHOY", "07501000080014", "LOTE-E2E-TARIFAHOY-01", "Botiquín E2E — Tarifario Hoy"),
  /** ServicePriceList — usados para comparar `servicio.priceListId` exacto en las aserciones. */
  priceLists: {
    isbm: "e2ef2000-0000-4000-8000-000000000901",
    mapfre: "e2ef2000-0000-4000-8000-000000000902",
    doctorsv: "e2ef2000-0000-4000-8000-000000000903",
    default: "e2ef2000-0000-4000-8000-000000000904",
  },
  /** TipoCuenta — usado por `patientAccount.regularizar` (prueba #7) y para verificar `tipoCuentaId`. */
  tiposCuenta: {
    isbm: "e2ef2000-0000-4000-8000-000000000801",
    mapfre: "e2ef2000-0000-4000-8000-000000000802",
    doctorsv: "e2ef2000-0000-4000-8000-000000000803",
  },
} as const;
