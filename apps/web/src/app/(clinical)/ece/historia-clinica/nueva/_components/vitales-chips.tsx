/**
 * Chips de resumen de signos vitales para la tarjeta "Examen físico" (CC-0007).
 * Presentación pura sobre `VitalesFormState` (módulo compartido CC-0012) —
 * no toca BD ni tRPC.
 */
import {
  imcFrom,
  ictFrom,
  glasgowTotal,
  fppNaegele,
} from "@his/contracts/validators";
import type { VitalesFormState } from "@/components/signos-vitales/types";

function parseNum(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function buildVitalesChips(v: VitalesFormState): string[] {
  const out: string[] = [];
  if (v.presionSistolica && v.presionDiastolica) {
    out.push(`TA ${v.presionSistolica}/${v.presionDiastolica} mmHg`);
  } else {
    if (v.presionSistolica) out.push(`TA sist ${v.presionSistolica} mmHg`);
    if (v.presionDiastolica) out.push(`TA diast ${v.presionDiastolica} mmHg`);
  }
  if (v.frecuenciaCardiaca) out.push(`FC ${v.frecuenciaCardiaca} lpm`);
  if (v.frecuenciaRespiratoria) out.push(`FR ${v.frecuenciaRespiratoria} rpm`);
  if (v.temperatura) out.push(`Temp ${v.temperatura} °C`);
  if (v.saturacionO2) out.push(`SpO₂ ${v.saturacionO2}%`);
  if (v.fio2) out.push(`FiO₂ ${v.fio2}%`);

  const gO = parseNum(v.glasgowOcular);
  const gV = parseNum(v.glasgowVerbal);
  const gM = parseNum(v.glasgowMotora);
  const gTotal = glasgowTotal(gO ?? null, gV ?? null, gM ?? null);
  if (gTotal != null) out.push(`Glasgow ${gTotal}/15`);

  if (v.glucometriaMgdl) out.push(`Gluco ${v.glucometriaMgdl} mg/dL`);
  if (v.pesoKg) out.push(`Peso ${v.pesoKg} kg`);
  else if (v.pesoLb) out.push(`Peso ${v.pesoLb} lb`);
  if (v.tallaM) out.push(`Talla ${v.tallaM} m`);
  else if (v.tallaFt) out.push(`Talla ${v.tallaFt} ft`);

  const pesoKgN = parseNum(v.pesoKg);
  const tallaMN = parseNum(v.tallaM);
  if (pesoKgN != null && tallaMN != null && tallaMN > 0) {
    out.push(`IMC ${imcFrom(pesoKgN, tallaMN).toFixed(1)}`);
  }
  const cinturaN = parseNum(v.perimetroCintura);
  if (cinturaN != null && tallaMN != null && tallaMN > 0) {
    out.push(`ICT ${ictFrom(cinturaN, tallaMN).toFixed(2)}`);
  }
  if (v.perimetroCintura) out.push(`Cintura ${v.perimetroCintura} cm`);
  if (v.balanceHidrico) out.push(`Balance ${v.balanceHidrico} mL`);
  if (v.diuresisHoraria) out.push(`Diuresis ${v.diuresisHoraria} mL/h`);
  if (v.fechaUltimaRegla) {
    out.push(`FUR ${v.fechaUltimaRegla}`);
    if (v.fppActivo) {
      const fpp = fppNaegele(v.fechaUltimaRegla);
      if (fpp) {
        out.push(`FPP ${fpp.toLocaleDateString("es-SV", { day: "2-digit", month: "2-digit", year: "numeric" })}`);
      }
    }
  }
  const gos = [v.gestaG, v.partoTermino, v.partoPretermino, v.abortos, v.vivos];
  if (gos.some((x) => x !== "")) {
    out.push(
      `GO G${v.gestaG || 0} P${v.partoTermino || 0} P${v.partoPretermino || 0} A${v.abortos || 0} V${v.vivos || 0}`,
    );
  }
  if (v.escalaDolor > 0) out.push(`Dolor ${v.escalaDolor}/10`);
  return out;
}
