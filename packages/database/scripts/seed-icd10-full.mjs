#!/usr/bin/env node
/**
 * Seed CIE-10 COMPLETO — Catálogo OMS versión española (~14,000 códigos).
 *
 * El seed parcial `seed-icd10.mjs` cargó ~300 códigos frecuentes.
 * Este script completa el catálogo con todos los bloques OMS CIE-10 versión 2019.
 *
 * FUENTE OFICIAL:
 *   https://www.who.int/standards/classifications/classification-of-diseases
 *   Dataset: ICD-10 Spanish Edition (OMS 2019), distribuido por PAHO/OPS.
 *
 * INSTRUCCIONES PARA GO-LIVE:
 *   1. Descargar `icd10_es_full.json` desde el repositorio OPS / MINSAL SV.
 *      URL referencia: https://iris.paho.org/handle/10665.2/44133
 *   2. Colocar el archivo en packages/database/data/icd10_es_full.json
 *   3. El script lo detecta automáticamente y carga todos los códigos.
 *
 *   Si el archivo no existe, el script carga el conjunto extendido inline
 *   (~600 códigos críticos MINSAL SV) como fallback — suficiente para pruebas.
 *
 * Uso:
 *   node --env-file=.env packages/database/scripts/seed-icd10-full.mjs
 *   DATABASE_URL=postgresql://... node packages/database/scripts/seed-icd10-full.mjs
 *
 * Idempotente: ON CONFLICT (codigo) DO NOTHING.
 * Tabla destino: public."Icd10Catalog" (Prisma PascalCase, schema public).
 */

import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Intenta cargar el dataset completo de disco; si no existe, retorna null.
 * @returns {Array<{codigo:string,descripcion:string,capitulo:string,grupo:string}>|null}
 */
function loadFullDataset() {
  const dataPath = join(__dirname, "..", "data", "icd10_es_full.json");
  if (!existsSync(dataPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(dataPath, "utf-8"));
    // Acepta dos formatos: array plano o { codigos: [...] }
    const codigos = Array.isArray(raw) ? raw : raw.codigos ?? raw.codes ?? [];
    if (codigos.length === 0) return null;
    console.log(`[icd10-full] Dataset externo cargado: ${codigos.length} entradas desde ${dataPath}`);
    return codigos;
  } catch (err) {
    console.warn(`[icd10-full] Advertencia: no se pudo parsear ${dataPath}: ${err.message}`);
    return null;
  }
}

// ─── Dataset fallback extendido ──────────────────────────────────────────────
// Complementa los 300 del seed parcial con bloques adicionales MINSAL SV.
// Marcados con fuente para auditoría.
/** @type {Array<{codigo:string,descripcion:string,capitulo:string,grupo:string}>} */
const FALLBACK_CODIGOS = [
  // ── Capítulo I — Infecciosas (completando gaps) ───────────────────────────
  { codigo: "A00.0", descripcion: "Cólera debida a Vibrio cholerae 01, biotipo cholerae", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A00.1", descripcion: "Cólera debida a Vibrio cholerae 01, biotipo El Tor", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A00.9", descripcion: "Cólera, no especificada", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A01.1", descripcion: "Paratifoidea A", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A01.2", descripcion: "Paratifoidea B", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A01.3", descripcion: "Paratifoidea C", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A01.4", descripcion: "Paratifoidea, no especificada", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A02.0", descripcion: "Enteritis por Salmonella", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A02.1", descripcion: "Septicemia por Salmonella", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A02.9", descripcion: "Infección por Salmonella, no especificada", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A03.0", descripcion: "Shigelosis debida a Shigella dysenteriae", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A03.9", descripcion: "Shigelosis, no especificada", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A04.0", descripcion: "Infección intestinal por Escherichia coli enteropatógena", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A04.1", descripcion: "Infección intestinal por Escherichia coli enterotoxígena", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A04.7", descripcion: "Enterocolitis debida a Clostridium difficile", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A04.9", descripcion: "Infección intestinal bacteriana, no especificada", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A05.0", descripcion: "Intoxicación alimentaria estafilocócica", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A05.1", descripcion: "Botulismo", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A05.9", descripcion: "Intoxicación alimentaria bacteriana, no especificada", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A06.1", descripcion: "Amebiasis intestinal crónica", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A06.2", descripcion: "Colitis amebiana no disentérica", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A06.4", descripcion: "Absceso hepático amebiano", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A07.0", descripcion: "Balantidiasis", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A07.1", descripcion: "Giardiasis", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A07.2", descripcion: "Criptosporidiosis", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A08.0", descripcion: "Enteritis debida a rotavirus", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A08.1", descripcion: "Gastroenteropatía aguda debida al agente de Norwalk", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A08.4", descripcion: "Infección intestinal viral, sin otra especificación", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A09.0", descripcion: "Otras gastroenteritis y colitis de origen infeccioso especificado", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A09.9", descripcion: "Gastroenteritis y colitis de origen no especificado", capitulo: "I", grupo: "A00-A09" },
  // Tuberculosis
  { codigo: "A15.1", descripcion: "Tuberculosis del pulmón, con confirmación por cultivo", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A15.2", descripcion: "Tuberculosis del pulmón, con confirmación histológica", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A15.3", descripcion: "Tuberculosis del pulmón, con confirmación por medios no especificados", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A15.4", descripcion: "Tuberculosis de ganglios linfáticos intratorácicos, con confirmación bacteriológica", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A15.6", descripcion: "Pleuritis tuberculosa, con confirmación bacteriológica", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A15.9", descripcion: "Tuberculosis respiratoria, con confirmación sin especificar", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A16.0", descripcion: "Tuberculosis del pulmón, con examen bacteriológico e histológico negativos", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A16.1", descripcion: "Tuberculosis del pulmón, sin realización de examen bacteriológico e histológico", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A16.4", descripcion: "Tuberculosis de ganglios linfáticos intratorácicos sin mención de confirmación bacteriológica", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A16.5", descripcion: "Laringotraqueítis tuberculosa sin mención de confirmación bacteriológica", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A16.9", descripcion: "Tuberculosis respiratoria no especificada, sin mención de confirmación bacteriológica", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A17.0", descripcion: "Meningitis tuberculosa", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A18.0", descripcion: "Tuberculosis de los huesos y articulaciones", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A18.1", descripcion: "Tuberculosis del aparato genitourinario", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A18.2", descripcion: "Linfadenopatía periférica tuberculosa", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A18.4", descripcion: "Tuberculosis del sistema nervioso", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A19.0", descripcion: "Tuberculosis miliar aguda de un sitio especificado", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A19.1", descripcion: "Tuberculosis miliar aguda de sitios múltiples", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A19.9", descripcion: "Tuberculosis miliar, no especificada", capitulo: "I", grupo: "A15-A19" },
  // Otras infecciosas frecuentes
  { codigo: "A20.9", descripcion: "Peste, no especificada", capitulo: "I", grupo: "A20-A28" },
  { codigo: "A22.0", descripcion: "Carbunco cutáneo", capitulo: "I", grupo: "A20-A28" },
  { codigo: "A27.0", descripcion: "Leptospirosis ictérica hemorrágica", capitulo: "I", grupo: "A20-A28" },
  { codigo: "A27.9", descripcion: "Leptospirosis, no especificada", capitulo: "I", grupo: "A20-A28" },
  { codigo: "A33", descripcion: "Tétanos neonatal", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A38", descripcion: "Escarlatina", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A39.0", descripcion: "Meningitis meningocócica", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A39.1", descripcion: "Síndrome de Waterhouse-Friderichsen", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A39.9", descripcion: "Infección meningocócica, no especificada", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A41.0", descripcion: "Septicemia debida a Staphylococcus aureus", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A41.1", descripcion: "Septicemia debida a otros Staphylococcus especificados", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A41.2", descripcion: "Septicemia debida a Staphylococcus no especificado", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A41.3", descripcion: "Septicemia debida a Haemophilus influenzae", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A41.4", descripcion: "Septicemia debida a anaerobios", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A41.5", descripcion: "Septicemia debida a otros microorganismos gramnegativos", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A41.8", descripcion: "Otras septicemias especificadas", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A48.1", descripcion: "Enfermedad de los legionarios", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A48.3", descripcion: "Síndrome del shock tóxico", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A49.0", descripcion: "Infección estafilocócica, sin otra especificación", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A49.1", descripcion: "Infección estreptocócica, sin otra especificación", capitulo: "I", grupo: "A30-A49" },
  // ITS
  { codigo: "A50.1", descripcion: "Sífilis congénita precoz, latente", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A50.9", descripcion: "Sífilis congénita, no especificada", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A51.1", descripcion: "Sífilis anal primaria", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A51.3", descripcion: "Sífilis secundaria de piel y membranas mucosas", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A51.9", descripcion: "Sífilis precoz, no especificada", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A52.1", descripcion: "Neurosífilis sintomática", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A52.9", descripcion: "Sífilis tardía, no especificada", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A53.9", descripcion: "Sífilis, no especificada", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A54.0", descripcion: "Infección gonocócica del tracto genitourinario inferior sin absceso", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A54.1", descripcion: "Infección gonocócica del tracto genitourinario inferior con absceso glandular", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A54.2", descripcion: "Pelviperitonitis gonocócica y otras infecciones gonocócicas genitourinarias", capitulo: "I", grupo: "A50-A64" },
  // VIH/SIDA
  { codigo: "B20.0", descripcion: "Enfermedad por VIH resultante en infección micobacteriana", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B20.1", descripcion: "Enfermedad por VIH resultante en otras infecciones bacterianas", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B20.2", descripcion: "Enfermedad por VIH resultante en citomegalovirosis", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B20.3", descripcion: "Enfermedad por VIH resultante en otras infecciones virales", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B20.4", descripcion: "Enfermedad por VIH resultante en candidiasis", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B20.5", descripcion: "Enfermedad por VIH resultante en otras micosis", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B20.6", descripcion: "Enfermedad por VIH resultante en neumonía por Pneumocystis carinii", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B21.0", descripcion: "Enfermedad por VIH resultante en sarcoma de Kaposi", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B22.0", descripcion: "Enfermedad por VIH resultante en encefalopatía", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B22.1", descripcion: "Enfermedad por VIH resultante en neumonitis linfoide intersticial", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B22.2", descripcion: "Enfermedad por VIH resultante en síndrome de emaciación", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B23.0", descripcion: "Síndrome de infección aguda por VIH", capitulo: "I", grupo: "B20-B24" },
  // Otras virales
  { codigo: "B34.9", descripcion: "Infección viral, no especificada", capitulo: "I", grupo: "B25-B34" },
  { codigo: "B37.0", descripcion: "Estomatitis candidiásica", capitulo: "I", grupo: "B35-B49" },
  { codigo: "B37.1", descripcion: "Candidiasis pulmonar", capitulo: "I", grupo: "B35-B49" },
  { codigo: "B37.2", descripcion: "Candidiasis de la piel y de las uñas", capitulo: "I", grupo: "B35-B49" },
  { codigo: "B37.3", descripcion: "Candidiasis de la vulva y de la vagina", capitulo: "I", grupo: "B35-B49" },
  { codigo: "B37.4", descripcion: "Candidiasis de otras regiones urogenitales", capitulo: "I", grupo: "B35-B49" },
  { codigo: "B37.5", descripcion: "Meningitis candidiásica", capitulo: "I", grupo: "B35-B49" },
  { codigo: "B37.9", descripcion: "Candidiasis, no especificada", capitulo: "I", grupo: "B35-B49" },
  { codigo: "B44.1", descripcion: "Aspergilosis pulmonar crónica", capitulo: "I", grupo: "B35-B49" },
  { codigo: "B50.9", descripcion: "Paludismo debido a Plasmodium falciparum, sin otra especificación", capitulo: "I", grupo: "B50-B64" },
  { codigo: "B54", descripcion: "Paludismo no especificado", capitulo: "I", grupo: "B50-B64" },
  { codigo: "B65.9", descripcion: "Esquistosomiasis, no especificada", capitulo: "I", grupo: "B65-B83" },
  { codigo: "B77.9", descripcion: "Ascariosis, no especificada", capitulo: "I", grupo: "B65-B83" },
  { codigo: "B82.9", descripcion: "Parasitosis intestinal, sin otra especificación", capitulo: "I", grupo: "B65-B83" },
  { codigo: "B85.0", descripcion: "Pediculosis debida a Pediculus humanus capitis", capitulo: "I", grupo: "B85-B89" },
  { codigo: "B86", descripcion: "Escabiosis", capitulo: "I", grupo: "B85-B89" },
  { codigo: "B99", descripcion: "Otras enfermedades infecciosas y parasitarias, y las no especificadas", capitulo: "I", grupo: "B99" },

  // ── Capítulo II — Neoplasias (completando gaps) ───────────────────────────
  { codigo: "C01", descripcion: "Neoplasia maligna de la base de la lengua", capitulo: "II", grupo: "C00-C14" },
  { codigo: "C02.9", descripcion: "Neoplasia maligna de la lengua, parte no especificada", capitulo: "II", grupo: "C00-C14" },
  { codigo: "C04.9", descripcion: "Neoplasia maligna del piso de la boca, parte no especificada", capitulo: "II", grupo: "C00-C14" },
  { codigo: "C07", descripcion: "Neoplasia maligna de la glándula parótida", capitulo: "II", grupo: "C00-C14" },
  { codigo: "C09.9", descripcion: "Neoplasia maligna de la amígdala, sin otra especificación", capitulo: "II", grupo: "C00-C14" },
  { codigo: "C11.9", descripcion: "Neoplasia maligna de la nasofaringe, parte no especificada", capitulo: "II", grupo: "C00-C14" },
  { codigo: "C13.9", descripcion: "Neoplasia maligna de la hipofaringe, parte no especificada", capitulo: "II", grupo: "C00-C14" },
  { codigo: "C14.0", descripcion: "Neoplasia maligna de la faringe, sin otra especificación", capitulo: "II", grupo: "C00-C14" },
  { codigo: "C15.9", descripcion: "Neoplasia maligna del esófago, parte no especificada", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C17.9", descripcion: "Neoplasia maligna del intestino delgado, parte no especificada", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C19", descripcion: "Neoplasia maligna de la unión rectosigmoidea", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C21.0", descripcion: "Neoplasia maligna del ano, sin otra especificación", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C22.1", descripcion: "Carcinoma de las vías biliares intrahepáticas", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C23", descripcion: "Neoplasia maligna de la vesícula biliar", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C24.9", descripcion: "Neoplasia maligna de las vías biliares, parte no especificada", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C32.9", descripcion: "Neoplasia maligna de la laringe, parte no especificada", capitulo: "II", grupo: "C30-C39" },
  { codigo: "C33", descripcion: "Neoplasia maligna de la tráquea", capitulo: "II", grupo: "C30-C39" },
  { codigo: "C37", descripcion: "Neoplasia maligna del timo", capitulo: "II", grupo: "C30-C39" },
  { codigo: "C38.0", descripcion: "Neoplasia maligna del corazón", capitulo: "II", grupo: "C30-C39" },
  { codigo: "C40.9", descripcion: "Neoplasia maligna de hueso y cartílago articular de miembro, sin otra especificación", capitulo: "II", grupo: "C40-C41" },
  { codigo: "C43.9", descripcion: "Melanoma maligno de la piel, sitio no especificado", capitulo: "II", grupo: "C43-C44" },
  { codigo: "C44.9", descripcion: "Neoplasia maligna de la piel, sitio no especificado", capitulo: "II", grupo: "C43-C44" },
  { codigo: "C45.0", descripcion: "Mesotelioma de la pleura", capitulo: "II", grupo: "C45-C49" },
  { codigo: "C47.9", descripcion: "Neoplasia maligna de nervio periférico y sistema nervioso autónomo, sitio no especificado", capitulo: "II", grupo: "C45-C49" },
  { codigo: "C48.0", descripcion: "Neoplasia maligna del retroperitoneo", capitulo: "II", grupo: "C45-C49" },
  { codigo: "C51.9", descripcion: "Neoplasia maligna de la vulva, parte no especificada", capitulo: "II", grupo: "C51-C58" },
  { codigo: "C52", descripcion: "Neoplasia maligna de la vagina", capitulo: "II", grupo: "C51-C58" },
  { codigo: "C54.0", descripcion: "Neoplasia maligna del istmo uterino", capitulo: "II", grupo: "C51-C58" },
  { codigo: "C55", descripcion: "Neoplasia maligna del útero, parte no especificada", capitulo: "II", grupo: "C51-C58" },
  { codigo: "C57.9", descripcion: "Neoplasia maligna de órganos genitales femeninos, parte no especificada", capitulo: "II", grupo: "C51-C58" },
  { codigo: "C58", descripcion: "Neoplasia maligna de la placenta", capitulo: "II", grupo: "C51-C58" },
  { codigo: "C62.9", descripcion: "Neoplasia maligna del testículo, no especificado", capitulo: "II", grupo: "C60-C63" },
  { codigo: "C64", descripcion: "Neoplasia maligna del riñón, excepto de la pelvis renal", capitulo: "II", grupo: "C64-C68" },
  { codigo: "C65", descripcion: "Neoplasia maligna de la pelvis renal", capitulo: "II", grupo: "C64-C68" },
  { codigo: "C66", descripcion: "Neoplasia maligna del uréter", capitulo: "II", grupo: "C64-C68" },
  { codigo: "C69.9", descripcion: "Neoplasia maligna del ojo y sus anexos, parte no especificada", capitulo: "II", grupo: "C69-C72" },
  { codigo: "C70.0", descripcion: "Neoplasia maligna de meninges cerebrales", capitulo: "II", grupo: "C69-C72" },
  { codigo: "C71.0", descripcion: "Neoplasia maligna del cerebro, excepto lóbulos y ventrículos", capitulo: "II", grupo: "C69-C72" },
  { codigo: "C71.9", descripcion: "Neoplasia maligna del encéfalo, parte no especificada", capitulo: "II", grupo: "C69-C72" },
  { codigo: "C72.0", descripcion: "Neoplasia maligna de la médula espinal", capitulo: "II", grupo: "C69-C72" },
  { codigo: "C73", descripcion: "Neoplasia maligna de la glándula tiroides", capitulo: "II", grupo: "C73-C75" },
  { codigo: "C74.0", descripcion: "Neoplasia maligna de la corteza de la glándula suprarrenal", capitulo: "II", grupo: "C73-C75" },
  { codigo: "C81.9", descripcion: "Enfermedad de Hodgkin, no especificada", capitulo: "II", grupo: "C81-C96" },
  { codigo: "C83.9", descripcion: "Linfoma difuso de células no Hendidas, tipo no especificado", capitulo: "II", grupo: "C81-C96" },
  { codigo: "C85.9", descripcion: "Linfoma no Hodgkin, tipo no especificado", capitulo: "II", grupo: "C81-C96" },
  { codigo: "C90.0", descripcion: "Mieloma múltiple", capitulo: "II", grupo: "C81-C96" },
  { codigo: "C91.0", descripcion: "Leucemia linfoblástica aguda", capitulo: "II", grupo: "C81-C96" },
  { codigo: "C91.1", descripcion: "Leucemia linfocítica crónica", capitulo: "II", grupo: "C81-C96" },
  { codigo: "C92.0", descripcion: "Leucemia mieloblástica aguda", capitulo: "II", grupo: "C81-C96" },
  { codigo: "C92.1", descripcion: "Leucemia mielocítica crónica", capitulo: "II", grupo: "C81-C96" },
  { codigo: "C95.0", descripcion: "Leucemia aguda de tipo celular no especificado", capitulo: "II", grupo: "C81-C96" },
  { codigo: "C97", descripcion: "Neoplasias malignas de localizaciones múltiples independientes (primarias)", capitulo: "II", grupo: "C97" },
  // Benignos / In situ frecuentes
  { codigo: "D00.0", descripcion: "Carcinoma in situ del labio, cavidad oral y faringe", capitulo: "II", grupo: "D00-D09" },
  { codigo: "D05.1", descripcion: "Carcinoma lobular in situ", capitulo: "II", grupo: "D00-D09" },
  { codigo: "D06.9", descripcion: "Carcinoma in situ del cuello uterino, parte no especificada", capitulo: "II", grupo: "D00-D09" },
  { codigo: "D17.9", descripcion: "Tumor benigno lipomatoso, no especificado", capitulo: "II", grupo: "D10-D36" },
  { codigo: "D21.9", descripcion: "Tumor benigno del tejido conjuntivo y de otros tejidos blandos, no especificado", capitulo: "II", grupo: "D10-D36" },
  { codigo: "D25.9", descripcion: "Leiomioma del útero, sin otra especificación", capitulo: "II", grupo: "D10-D36" },
  { codigo: "D27", descripcion: "Tumor benigno del ovario", capitulo: "II", grupo: "D10-D36" },
  { codigo: "D33.2", descripcion: "Tumor benigno del encéfalo, no especificado", capitulo: "II", grupo: "D10-D36" },
  { codigo: "D34", descripcion: "Tumor benigno de la glándula tiroides", capitulo: "II", grupo: "D10-D36" },
  { codigo: "D35.0", descripcion: "Tumor benigno de la glándula suprarrenal", capitulo: "II", grupo: "D10-D36" },
  { codigo: "D36.9", descripcion: "Tumor benigno, de sitio no especificado", capitulo: "II", grupo: "D10-D36" },
  { codigo: "D45", descripcion: "Policitemia vera", capitulo: "II", grupo: "D37-D48" },
  { codigo: "D46.9", descripcion: "Síndrome mielodisplásico, no especificado", capitulo: "II", grupo: "D37-D48" },
  { codigo: "D48.9", descripcion: "Neoplasia de comportamiento incierto o desconocido, de sitio no especificado", capitulo: "II", grupo: "D37-D48" },

  // ── Capítulo III — Sangre (completando) ──────────────────────────────────
  { codigo: "D50.0", descripcion: "Anemia por deficiencia de hierro secundaria a pérdida de sangre (crónica)", capitulo: "III", grupo: "D50-D53" },
  { codigo: "D50.1", descripcion: "Anemia sideropenica disfágica", capitulo: "III", grupo: "D50-D53" },
  { codigo: "D51.0", descripcion: "Anemia por deficiencia de vitamina B12 debida a deficiencia del factor intrínseco", capitulo: "III", grupo: "D50-D53" },
  { codigo: "D52.0", descripcion: "Anemia por deficiencia de folatos, dietética", capitulo: "III", grupo: "D50-D53" },
  { codigo: "D52.9", descripcion: "Anemia por deficiencia de folatos, no especificada", capitulo: "III", grupo: "D50-D53" },
  { codigo: "D53.9", descripcion: "Anemia nutricional, no especificada", capitulo: "III", grupo: "D50-D53" },
  { codigo: "D55.9", descripcion: "Anemia debida a trastornos enzimáticos, no especificada", capitulo: "III", grupo: "D55-D59" },
  { codigo: "D57.0", descripcion: "Anemia de células falciformes con crisis", capitulo: "III", grupo: "D55-D59" },
  { codigo: "D57.1", descripcion: "Anemia de células falciformes sin crisis", capitulo: "III", grupo: "D55-D59" },
  { codigo: "D58.9", descripcion: "Anemia hemolítica hereditaria, no especificada", capitulo: "III", grupo: "D55-D59" },
  { codigo: "D59.0", descripcion: "Anemia hemolítica autoinmune inducida por drogas", capitulo: "III", grupo: "D55-D59" },
  { codigo: "D59.1", descripcion: "Otras anemias hemolíticas autoinmunes", capitulo: "III", grupo: "D55-D59" },
  { codigo: "D60.9", descripcion: "Aplasia pura de células rojas, adquirida, no especificada", capitulo: "III", grupo: "D60-D64" },
  { codigo: "D61.9", descripcion: "Anemia aplástica, no especificada", capitulo: "III", grupo: "D60-D64" },
  { codigo: "D62", descripcion: "Anemia posthemorrágica aguda", capitulo: "III", grupo: "D60-D64" },
  { codigo: "D65", descripcion: "Coagulación intravascular diseminada", capitulo: "III", grupo: "D65-D69" },
  { codigo: "D66", descripcion: "Deficiencia hereditaria del factor VIII", capitulo: "III", grupo: "D65-D69" },
  { codigo: "D67", descripcion: "Deficiencia hereditaria del factor IX", capitulo: "III", grupo: "D65-D69" },
  { codigo: "D68.9", descripcion: "Defecto de la coagulación, no especificado", capitulo: "III", grupo: "D65-D69" },
  { codigo: "D69.0", descripcion: "Púrpura alérgica", capitulo: "III", grupo: "D65-D69" },
  { codigo: "D69.6", descripcion: "Trombocitopenia, no especificada", capitulo: "III", grupo: "D65-D69" },
  { codigo: "D70", descripcion: "Agranulocitosis", capitulo: "III", grupo: "D70-D77" },
  { codigo: "D72.1", descripcion: "Eosinofilia", capitulo: "III", grupo: "D70-D77" },
  { codigo: "D76.1", descripcion: "Linfohistiocitosis hemofagocítica", capitulo: "III", grupo: "D70-D77" },
  { codigo: "D80.9", descripcion: "Inmunodeficiencia con predominio de defectos de anticuerpos, no especificada", capitulo: "III", grupo: "D80-D89" },
  { codigo: "D89.9", descripcion: "Trastorno que afecta el sistema inmunitario, no especificado", capitulo: "III", grupo: "D80-D89" },

  // ── Capítulo IV — Endocrinas (completando) ────────────────────────────────
  { codigo: "E00.9", descripcion: "Síndrome de deficiencia de yodo congénito, no especificado", capitulo: "IV", grupo: "E00-E07" },
  { codigo: "E03.9", descripcion: "Hipotiroidismo, no especificado", capitulo: "IV", grupo: "E00-E07" },
  { codigo: "E04.9", descripcion: "Bocio no tóxico, no especificado", capitulo: "IV", grupo: "E00-E07" },
  { codigo: "E05.0", descripcion: "Tirotoxicosis con bocio difuso", capitulo: "IV", grupo: "E00-E07" },
  { codigo: "E05.9", descripcion: "Tirotoxicosis, no especificada", capitulo: "IV", grupo: "E00-E07" },
  { codigo: "E06.9", descripcion: "Tiroiditis, no especificada", capitulo: "IV", grupo: "E00-E07" },
  { codigo: "E07.9", descripcion: "Trastorno de la glándula tiroides, no especificado", capitulo: "IV", grupo: "E00-E07" },
  { codigo: "E10.0", descripcion: "Diabetes mellitus insulinodependiente con coma", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E10.1", descripcion: "Diabetes mellitus insulinodependiente con cetoacidosis", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E10.2", descripcion: "Diabetes mellitus insulinodependiente con complicaciones renales", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E10.3", descripcion: "Diabetes mellitus insulinodependiente con complicaciones oftálmicas", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E10.4", descripcion: "Diabetes mellitus insulinodependiente con complicaciones neurológicas", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E10.5", descripcion: "Diabetes mellitus insulinodependiente con complicaciones circulatorias periféricas", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E10.6", descripcion: "Diabetes mellitus insulinodependiente con otras complicaciones especificadas", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E10.7", descripcion: "Diabetes mellitus insulinodependiente con complicaciones múltiples", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E11.1", descripcion: "Diabetes mellitus no insulinodependiente con cetoacidosis", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E11.2", descripcion: "Diabetes mellitus no insulinodependiente con complicaciones renales", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E11.3", descripcion: "Diabetes mellitus no insulinodependiente con complicaciones oftálmicas", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E11.4", descripcion: "Diabetes mellitus no insulinodependiente con complicaciones neurológicas", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E11.6", descripcion: "Diabetes mellitus no insulinodependiente con otras complicaciones especificadas", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E11.7", descripcion: "Diabetes mellitus no insulinodependiente con complicaciones múltiples", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E14.0", descripcion: "Diabetes mellitus no especificada con coma", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E14.1", descripcion: "Diabetes mellitus no especificada con cetoacidosis", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E20.0", descripcion: "Hipoparatiroidismo idiopático", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E20.9", descripcion: "Hipoparatiroidismo, no especificado", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E21.0", descripcion: "Hiperparatiroidismo primario", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E22.0", descripcion: "Acromegalia y gigantismo hipofisario", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E22.1", descripcion: "Hiperprolactinemia", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E23.0", descripcion: "Hipopituitarismo", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E24.0", descripcion: "Síndrome de Cushing dependiente de hipófisis", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E24.9", descripcion: "Síndrome de Cushing, no especificado", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E25.9", descripcion: "Trastorno adrenogenital, no especificado", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E26.0", descripcion: "Hiperaldosteronismo primario", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E27.1", descripcion: "Insuficiencia corticosuprarrenal primaria", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E27.4", descripcion: "Otras deficiencias corticosuprarrenales y las no especificadas", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E27.9", descripcion: "Trastorno de la glándula suprarrenal, no especificado", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E28.2", descripcion: "Síndrome de ovario poliquístico", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E29.1", descripcion: "Hipofunción testicular", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E34.9", descripcion: "Trastorno endocrino, no especificado", capitulo: "IV", grupo: "E20-E35" },
  { codigo: "E43", descripcion: "Desnutrición proteico-calórica grave, no especificada", capitulo: "IV", grupo: "E40-E46" },
  { codigo: "E50.9", descripcion: "Deficiencia de vitamina A, no especificada", capitulo: "IV", grupo: "E50-E64" },
  { codigo: "E55.0", descripcion: "Raquitismo activo", capitulo: "IV", grupo: "E50-E64" },
  { codigo: "E55.9", descripcion: "Deficiencia de vitamina D, no especificada", capitulo: "IV", grupo: "E50-E64" },
  { codigo: "E58", descripcion: "Deficiencia de calcio en la dieta", capitulo: "IV", grupo: "E50-E64" },
  { codigo: "E63.9", descripcion: "Deficiencia nutricional, no especificada", capitulo: "IV", grupo: "E50-E64" },
  { codigo: "E83.1", descripcion: "Trastornos del metabolismo del hierro", capitulo: "IV", grupo: "E70-E90" },
  { codigo: "E85.9", descripcion: "Amiloidosis, no especificada", capitulo: "IV", grupo: "E70-E90" },
  { codigo: "E88.9", descripcion: "Trastorno metabólico, no especificado", capitulo: "IV", grupo: "E70-E90" },
  { codigo: "E89.0", descripcion: "Hipotiroidismo postprocedimiento", capitulo: "IV", grupo: "E70-E90" },

  // ── Capítulo V — Mentales (completando) ───────────────────────────────────
  { codigo: "F00.9", descripcion: "Demencia en la enfermedad de Alzheimer, sin especificación", capitulo: "V", grupo: "F00-F09" },
  { codigo: "F01.9", descripcion: "Demencia vascular, sin especificación", capitulo: "V", grupo: "F00-F09" },
  { codigo: "F02.3", descripcion: "Demencia en la enfermedad de Parkinson", capitulo: "V", grupo: "F00-F09" },
  { codigo: "F03", descripcion: "Demencia, no especificada", capitulo: "V", grupo: "F00-F09" },
  { codigo: "F05.9", descripcion: "Delirium, no especificado", capitulo: "V", grupo: "F00-F09" },
  { codigo: "F06.9", descripcion: "Trastorno mental orgánico o sintomático, no especificado", capitulo: "V", grupo: "F00-F09" },
  { codigo: "F10.0", descripcion: "Trastornos mentales y del comportamiento debidos al uso de alcohol: intoxicación aguda", capitulo: "V", grupo: "F10-F19" },
  { codigo: "F10.3", descripcion: "Trastornos mentales debidos al alcohol: estado de abstinencia", capitulo: "V", grupo: "F10-F19" },
  { codigo: "F11.2", descripcion: "Trastornos mentales debidos al uso de opioides: síndrome de dependencia", capitulo: "V", grupo: "F10-F19" },
  { codigo: "F12.2", descripcion: "Trastornos mentales debidos al uso de cannabinoides: síndrome de dependencia", capitulo: "V", grupo: "F10-F19" },
  { codigo: "F14.2", descripcion: "Trastornos mentales debidos al uso de cocaína: síndrome de dependencia", capitulo: "V", grupo: "F10-F19" },
  { codigo: "F19.2", descripcion: "Trastornos mentales debidos al uso de múltiples drogas: síndrome de dependencia", capitulo: "V", grupo: "F10-F19" },
  { codigo: "F20.0", descripcion: "Esquizofrenia paranoide", capitulo: "V", grupo: "F20-F29" },
  { codigo: "F20.1", descripcion: "Esquizofrenia hebefrénica", capitulo: "V", grupo: "F20-F29" },
  { codigo: "F20.3", descripcion: "Esquizofrenia indiferenciada", capitulo: "V", grupo: "F20-F29" },
  { codigo: "F20.5", descripcion: "Esquizofrenia residual", capitulo: "V", grupo: "F20-F29" },
  { codigo: "F22.0", descripcion: "Trastorno delirante", capitulo: "V", grupo: "F20-F29" },
  { codigo: "F25.9", descripcion: "Trastorno esquizoafectivo, tipo no especificado", capitulo: "V", grupo: "F20-F29" },
  { codigo: "F29", descripcion: "Psicosis no orgánica, no especificada", capitulo: "V", grupo: "F20-F29" },
  { codigo: "F30.9", descripcion: "Episodio maníaco, no especificado", capitulo: "V", grupo: "F30-F39" },
  { codigo: "F31.9", descripcion: "Trastorno bipolar, no especificado", capitulo: "V", grupo: "F30-F39" },
  { codigo: "F32.0", descripcion: "Episodio depresivo leve", capitulo: "V", grupo: "F30-F39" },
  { codigo: "F32.1", descripcion: "Episodio depresivo moderado", capitulo: "V", grupo: "F30-F39" },
  { codigo: "F32.2", descripcion: "Episodio depresivo grave sin síntomas psicóticos", capitulo: "V", grupo: "F30-F39" },
  { codigo: "F32.3", descripcion: "Episodio depresivo grave con síntomas psicóticos", capitulo: "V", grupo: "F30-F39" },
  { codigo: "F33.9", descripcion: "Trastorno depresivo recurrente, no especificado", capitulo: "V", grupo: "F30-F39" },
  { codigo: "F40.0", descripcion: "Agorafobia", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F40.1", descripcion: "Fobias sociales", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F40.2", descripcion: "Fobia específica (aislada)", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F41.0", descripcion: "Trastorno de pánico (ansiedad paroxística episódica)", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F41.9", descripcion: "Trastorno de ansiedad, no especificado", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F42", descripcion: "Trastorno obsesivo-compulsivo", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F43.0", descripcion: "Reacción aguda al estrés", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F43.2", descripcion: "Trastorno de adaptación", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F44.9", descripcion: "Trastorno disociativo (de conversión), no especificado", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F45.0", descripcion: "Trastorno de somatización", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F48.9", descripcion: "Trastorno neurótico, no especificado", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F50.0", descripcion: "Anorexia nerviosa", capitulo: "V", grupo: "F50-F59" },
  { codigo: "F50.2", descripcion: "Bulimia nerviosa", capitulo: "V", grupo: "F50-F59" },
  { codigo: "F51.0", descripcion: "Insomnio no orgánico", capitulo: "V", grupo: "F50-F59" },
  { codigo: "F60.3", descripcion: "Trastorno de personalidad emocionalmente inestable", capitulo: "V", grupo: "F60-F69" },
  { codigo: "F60.9", descripcion: "Trastorno de personalidad, no especificado", capitulo: "V", grupo: "F60-F69" },
  { codigo: "F63.0", descripcion: "Juego patológico", capitulo: "V", grupo: "F60-F69" },
  { codigo: "F70.0", descripcion: "Retraso mental leve con discapacidad del comportamiento mínima o nula", capitulo: "V", grupo: "F70-F79" },
  { codigo: "F70.9", descripcion: "Retraso mental leve, sin mención de discapacidad del comportamiento", capitulo: "V", grupo: "F70-F79" },
  { codigo: "F84.0", descripcion: "Autismo en la niñez", capitulo: "V", grupo: "F80-F89" },
  { codigo: "F84.9", descripcion: "Trastorno generalizado del desarrollo, no especificado", capitulo: "V", grupo: "F80-F89" },
  { codigo: "F90.0", descripcion: "Perturbación de la actividad y de la atención", capitulo: "V", grupo: "F90-F98" },
  { codigo: "F91.9", descripcion: "Trastorno de la conducta, no especificado", capitulo: "V", grupo: "F90-F98" },
  { codigo: "F99", descripcion: "Trastorno mental, no especificado", capitulo: "V", grupo: "F99" },

  // ── Capítulo VI — Sistema nervioso (completando) ──────────────────────────
  { codigo: "G00.1", descripcion: "Meningitis neumocócica", capitulo: "VI", grupo: "G00-G09" },
  { codigo: "G00.2", descripcion: "Meningitis estreptocócica", capitulo: "VI", grupo: "G00-G09" },
  { codigo: "G01", descripcion: "Meningitis en enfermedades bacterianas clasificadas en otra parte", capitulo: "VI", grupo: "G00-G09" },
  { codigo: "G03.9", descripcion: "Meningitis, no especificada", capitulo: "VI", grupo: "G00-G09" },
  { codigo: "G04.9", descripcion: "Encefalitis, mielitis y encefalomielitis, no especificada", capitulo: "VI", grupo: "G00-G09" },
  { codigo: "G06.0", descripcion: "Absceso y granuloma intracraneal", capitulo: "VI", grupo: "G00-G09" },
  { codigo: "G10", descripcion: "Enfermedad de Huntington", capitulo: "VI", grupo: "G10-G13" },
  { codigo: "G20", descripcion: "Enfermedad de Parkinson", capitulo: "VI", grupo: "G20-G26" },
  { codigo: "G21.9", descripcion: "Parkinsonismo secundario, no especificado", capitulo: "VI", grupo: "G20-G26" },
  { codigo: "G30.0", descripcion: "Enfermedad de Alzheimer de comienzo temprano", capitulo: "VI", grupo: "G30-G32" },
  { codigo: "G30.1", descripcion: "Enfermedad de Alzheimer de comienzo tardío", capitulo: "VI", grupo: "G30-G32" },
  { codigo: "G30.9", descripcion: "Enfermedad de Alzheimer, no especificada", capitulo: "VI", grupo: "G30-G32" },
  { codigo: "G40.0", descripcion: "Epilepsia y síndromes epilépticos idiopáticos localizados con ataques de comienzo focal", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G40.3", descripcion: "Epilepsia idiopática generalizada", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G41.9", descripcion: "Epilepsia, estado, no especificada", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G43.0", descripcion: "Migraña sin aura (migraña ordinaria)", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G43.1", descripcion: "Migraña con aura (migraña clásica)", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G44.2", descripcion: "Cefalea tensional", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G45.0", descripcion: "Síndrome de la arteria vertebrobasilar", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G47.0", descripcion: "Trastornos del inicio y del mantenimiento del sueño", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G47.3", descripcion: "Apnea del sueño", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G51.0", descripcion: "Parálisis de Bell", capitulo: "VI", grupo: "G50-G59" },
  { codigo: "G54.2", descripcion: "Lesiones de la raíz cervical, no clasificadas en otra parte", capitulo: "VI", grupo: "G50-G59" },
  { codigo: "G54.4", descripcion: "Lesiones de la raíz lumbosacra, no clasificadas en otra parte", capitulo: "VI", grupo: "G50-G59" },
  { codigo: "G56.0", descripcion: "Síndrome del túnel carpiano", capitulo: "VI", grupo: "G50-G59" },
  { codigo: "G58.9", descripcion: "Mononeuropatía, no especificada", capitulo: "VI", grupo: "G50-G59" },
  { codigo: "G61.0", descripcion: "Síndrome de Guillain-Barré", capitulo: "VI", grupo: "G60-G64" },
  { codigo: "G63.2", descripcion: "Polineuropatía diabética", capitulo: "VI", grupo: "G60-G64" },
  { codigo: "G70.0", descripcion: "Miastenia gravis", capitulo: "VI", grupo: "G70-G73" },
  { codigo: "G71.0", descripcion: "Distrofia muscular", capitulo: "VI", grupo: "G70-G73" },
  { codigo: "G80.0", descripcion: "Parálisis cerebral espástica cuadripléjica", capitulo: "VI", grupo: "G80-G83" },
  { codigo: "G80.1", descripcion: "Parálisis cerebral espástica dipléjica", capitulo: "VI", grupo: "G80-G83" },
  { codigo: "G80.9", descripcion: "Parálisis cerebral, no especificada", capitulo: "VI", grupo: "G80-G83" },
  { codigo: "G82.4", descripcion: "Paraplejía, no especificada", capitulo: "VI", grupo: "G80-G83" },
  { codigo: "G83.9", descripcion: "Síndrome paralítico, no especificado", capitulo: "VI", grupo: "G80-G83" },
  { codigo: "G89.0", descripcion: "Dolor central, no especificado", capitulo: "VI", grupo: "G89-G99" },
  { codigo: "G91.9", descripcion: "Hidrocefalia, no especificada", capitulo: "VI", grupo: "G89-G99" },
  { codigo: "G93.1", descripcion: "Lesión cerebral anóxica, no clasificada en otra parte", capitulo: "VI", grupo: "G89-G99" },
  { codigo: "G93.4", descripcion: "Encefalopatía no especificada", capitulo: "VI", grupo: "G89-G99" },
  { codigo: "G95.9", descripcion: "Enfermedad de la médula espinal, no especificada", capitulo: "VI", grupo: "G89-G99" },
  { codigo: "G99.2", descripcion: "Mielopatía en enfermedades clasificadas en otra parte", capitulo: "VI", grupo: "G89-G99" },

  // ── Capítulos XIV-XXI: algunos gaps adicionales críticos ──────────────────
  { codigo: "N00.0", descripcion: "Síndrome nefrítico agudo, con lesión glomerular mínima", capitulo: "XIV", grupo: "N00-N08" },
  { codigo: "N03.9", descripcion: "Síndrome nefrítico crónico, no especificado", capitulo: "XIV", grupo: "N00-N08" },
  { codigo: "N04.9", descripcion: "Síndrome nefrótico, no especificado", capitulo: "XIV", grupo: "N00-N08" },
  { codigo: "N10", descripcion: "Nefritis tubulointersticial aguda", capitulo: "XIV", grupo: "N10-N16" },
  { codigo: "N11.9", descripcion: "Nefritis tubulointersticial crónica, no especificada", capitulo: "XIV", grupo: "N10-N16" },
  { codigo: "N18.1", descripcion: "Enfermedad renal crónica, etapa 1", capitulo: "XIV", grupo: "N17-N19" },
  { codigo: "N18.2", descripcion: "Enfermedad renal crónica, etapa 2", capitulo: "XIV", grupo: "N17-N19" },
  { codigo: "N18.3", descripcion: "Enfermedad renal crónica, etapa 3", capitulo: "XIV", grupo: "N17-N19" },
  { codigo: "N18.4", descripcion: "Enfermedad renal crónica, etapa 4", capitulo: "XIV", grupo: "N17-N19" },
  { codigo: "N18.5", descripcion: "Enfermedad renal crónica, etapa 5", capitulo: "XIV", grupo: "N17-N19" },
  { codigo: "N19", descripcion: "Insuficiencia renal, no especificada", capitulo: "XIV", grupo: "N17-N19" },
  { codigo: "N28.9", descripcion: "Trastorno del riñón y del uréter, no especificado", capitulo: "XIV", grupo: "N25-N29" },
  { codigo: "N30.9", descripcion: "Cistitis, no especificada", capitulo: "XIV", grupo: "N30-N39" },
  { codigo: "N35.9", descripcion: "Estenosis uretral, no especificada", capitulo: "XIV", grupo: "N30-N39" },
  { codigo: "N39.3", descripcion: "Incontinencia urinaria de esfuerzo", capitulo: "XIV", grupo: "N30-N39" },
  { codigo: "N39.9", descripcion: "Trastorno del sistema urinario, no especificado", capitulo: "XIV", grupo: "N30-N39" },
  { codigo: "N41.0", descripcion: "Prostatitis aguda", capitulo: "XIV", grupo: "N40-N51" },
  { codigo: "N41.1", descripcion: "Prostatitis crónica", capitulo: "XIV", grupo: "N40-N51" },
  { codigo: "N41.9", descripcion: "Enfermedad inflamatoria de la próstata, no especificada", capitulo: "XIV", grupo: "N40-N51" },
  { codigo: "N43.3", descripcion: "Hidrocele, no especificado", capitulo: "XIV", grupo: "N40-N51" },
  { codigo: "N45.9", descripcion: "Orquitis, epididimitis y epidídimo-orquitis sin mención de absceso", capitulo: "XIV", grupo: "N40-N51" },
  { codigo: "N47", descripcion: "Fimosis y parafimosis", capitulo: "XIV", grupo: "N40-N51" },
  { codigo: "N48.6", descripcion: "Induración plástica del pene", capitulo: "XIV", grupo: "N40-N51" },
  { codigo: "N60.1", descripcion: "Mastopatía quística difusa", capitulo: "XIV", grupo: "N60-N64" },
  { codigo: "N63", descripcion: "Masa no especificada en la mama", capitulo: "XIV", grupo: "N60-N64" },
  { codigo: "N70.1", descripcion: "Salpingitis y ooforitis crónicas", capitulo: "XIV", grupo: "N70-N77" },
  { codigo: "N70.9", descripcion: "Salpingitis y ooforitis, no especificadas", capitulo: "XIV", grupo: "N70-N77" },
  { codigo: "N71.0", descripcion: "Enfermedad inflamatoria aguda del útero", capitulo: "XIV", grupo: "N70-N77" },
  { codigo: "N71.9", descripcion: "Enfermedad inflamatoria del útero, no especificada", capitulo: "XIV", grupo: "N70-N77" },
  { codigo: "N72", descripcion: "Enfermedad inflamatoria del cuello uterino", capitulo: "XIV", grupo: "N70-N77" },
  { codigo: "N76.0", descripcion: "Vaginitis aguda", capitulo: "XIV", grupo: "N70-N77" },
  { codigo: "N76.1", descripcion: "Vaginitis subaguda y crónica", capitulo: "XIV", grupo: "N70-N77" },
  { codigo: "N80.1", descripcion: "Endometriosis de los ovarios", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N81.2", descripcion: "Incompleto prolapso uterovaginal", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N81.4", descripcion: "Prolapso uterovaginal, sin otra especificación", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N84.1", descripcion: "Pólipo del cuello uterino", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N87.1", descripcion: "Displasia moderada del cuello uterino", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N87.9", descripcion: "Displasia del cuello uterino, no especificada", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N89.3", descripcion: "Displasia vaginal, no especificada", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N91.2", descripcion: "Amenorrea, no especificada", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N93.9", descripcion: "Hemorragia uterina o vaginal anormal, no especificada", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N94.0", descripcion: "Dolor intermenstrual", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N94.6", descripcion: "Dismenorrea, no especificada", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N95.1", descripcion: "Menopausia y estados del climaterio femenino", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N96", descripcion: "Abortadora habitual", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N97.0", descripcion: "Infertilidad femenina asociada con anovulación", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N97.9", descripcion: "Infertilidad femenina, no especificada", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N98.9", descripcion: "Complicación de procedimientos de fecundación artificial, no especificada", capitulo: "XIV", grupo: "N80-N98" },

  // ── Algunos Z (factores salud) críticos ────────────────────────────────────
  { codigo: "Z01.0", descripcion: "Examen de los ojos y de la visión", capitulo: "XXI", grupo: "Z00-Z13" },
  { codigo: "Z01.1", descripcion: "Examen de los oídos y de la audición", capitulo: "XXI", grupo: "Z00-Z13" },
  { codigo: "Z01.5", descripcion: "Examen diagnóstico con rayos X", capitulo: "XXI", grupo: "Z00-Z13" },
  { codigo: "Z03.5", descripcion: "Observación por sospecha de trastorno cardíaco", capitulo: "XXI", grupo: "Z00-Z13" },
  { codigo: "Z04.8", descripcion: "Examen y observación por otras razones especificadas", capitulo: "XXI", grupo: "Z00-Z13" },
  { codigo: "Z04.9", descripcion: "Examen y observación por razón no especificada", capitulo: "XXI", grupo: "Z00-Z13" },
  { codigo: "Z13.9", descripcion: "Examen de detección de enfermedad, no especificada", capitulo: "XXI", grupo: "Z00-Z13" },
  { codigo: "Z23.0", descripcion: "Inmunización contra cólera", capitulo: "XXI", grupo: "Z20-Z29" },
  { codigo: "Z24.0", descripcion: "Necesidad de vacunación contra la poliomielitis", capitulo: "XXI", grupo: "Z20-Z29" },
  { codigo: "Z25.0", descripcion: "Necesidad de vacunación contra la parotiditis", capitulo: "XXI", grupo: "Z20-Z29" },
  { codigo: "Z25.1", descripcion: "Necesidad de vacunación contra la influenza", capitulo: "XXI", grupo: "Z20-Z29" },
  { codigo: "Z26.9", descripcion: "Necesidad de vacunación contra enfermedad infecciosa no especificada", capitulo: "XXI", grupo: "Z20-Z29" },
  { codigo: "Z29.2", descripcion: "Otra quimioprofilaxis", capitulo: "XXI", grupo: "Z20-Z29" },
  { codigo: "Z30.0", descripcion: "Asesoramiento y consejería general sobre anticoncepción", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z30.1", descripcion: "Inserción de dispositivo anticonceptivo (intrauterino)", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z33", descripcion: "Estado de embarazo, incidental", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z34.0", descripcion: "Supervisión de embarazo normal primario", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z34.8", descripcion: "Supervisión de otro embarazo normal", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z35.9", descripcion: "Supervisión de embarazo de alto riesgo, sin especificación", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z36", descripcion: "Detección prenatal", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z37.1", descripcion: "Producto único, nacido muerto", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z37.2", descripcion: "Gemelos, ambos nacidos vivos", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z37.9", descripcion: "Resultado del parto, no especificado", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z38.1", descripcion: "Recién nacido único, nacido fuera del hospital", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z39.0", descripcion: "Atención y examen inmediatamente después del parto", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z39.1", descripcion: "Atención y examen del niño lactante", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z39.2", descripcion: "Seguimiento posparto de rutina", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z40.0", descripcion: "Cirugía profiláctica por factores de riesgo relacionados con neoplasias malignas", capitulo: "XXI", grupo: "Z40-Z54" },
  { codigo: "Z43.0", descripcion: "Atención a traqueostomía", capitulo: "XXI", grupo: "Z40-Z54" },
  { codigo: "Z45.0", descripcion: "Ajuste y mantenimiento de marcapasos cardíaco", capitulo: "XXI", grupo: "Z40-Z54" },
  { codigo: "Z48.0", descripcion: "Atención de los apósitos y suturas quirúrgicas", capitulo: "XXI", grupo: "Z40-Z54" },
  { codigo: "Z51.0", descripcion: "Sesión de radioterapia", capitulo: "XXI", grupo: "Z40-Z54" },
  { codigo: "Z51.2", descripcion: "Otra quimioterapia", capitulo: "XXI", grupo: "Z40-Z54" },
  { codigo: "Z51.5", descripcion: "Cuidados paliativos", capitulo: "XXI", grupo: "Z40-Z54" },
  { codigo: "Z52.9", descripcion: "Donante, no especificado", capitulo: "XXI", grupo: "Z52" },
  { codigo: "Z54.0", descripcion: "Convalecencia consecutiva a cirugía", capitulo: "XXI", grupo: "Z40-Z54" },
  { codigo: "Z60.4", descripcion: "Exclusión y rechazo social", capitulo: "XXI", grupo: "Z55-Z65" },
  { codigo: "Z63.0", descripcion: "Problemas en la relación con el cónyuge o pareja", capitulo: "XXI", grupo: "Z55-Z65" },
  { codigo: "Z71.1", descripcion: "Persona que consulta en nombre de otra persona", capitulo: "XXI", grupo: "Z70-Z76" },
  { codigo: "Z72.0", descripcion: "Uso del tabaco", capitulo: "XXI", grupo: "Z70-Z76" },
  { codigo: "Z73.0", descripcion: "Agotamiento vital (burn-out)", capitulo: "XXI", grupo: "Z70-Z76" },
  { codigo: "Z74.0", descripcion: "Movilidad reducida", capitulo: "XXI", grupo: "Z70-Z76" },
  { codigo: "Z75.1", descripcion: "Persona en lista de espera", capitulo: "XXI", grupo: "Z70-Z76" },
  { codigo: "Z76.0", descripcion: "Emisión de prescripción iterativa", capitulo: "XXI", grupo: "Z70-Z76" },
  { codigo: "Z80.0", descripcion: "Historia familiar de neoplasia maligna del tubo digestivo", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z82.4", descripcion: "Historia familiar de epilepsia y otras enfermedades del sistema nervioso", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z86.1", descripcion: "Historia personal de enfermedades infecciosas y parasitarias", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z87.3", descripcion: "Historia personal de enfermedades del sistema musculoesquelético y del tejido conjuntivo", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z88.0", descripcion: "Alergia a la penicilina", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z88.1", descripcion: "Alergia a otros antibióticos", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z88.9", descripcion: "Alergia a medicamentos, drogas o sustancias biológicas, no especificada", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z89.9", descripcion: "Ausencia adquirida de miembro, no especificado", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z90.0", descripcion: "Ausencia adquirida de parte de la cabeza y del cuello", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z91.0", descripcion: "Alergia a otros agentes que no sean medicamentos y sustancias biológicas", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z95.0", descripcion: "Presencia de marcapasos cardíaco", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z95.1", descripcion: "Presencia de bypass aortocoronario (de derivación)", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z96.1", descripcion: "Presencia de implante de cristalino intraocular", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z96.6", descripcion: "Presencia de articulaciones ortopédicas artificiales", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z98.0", descripcion: "Estado postintestinal (cirugía intestinal)", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z99.2", descripcion: "Dependencia de diálisis renal", capitulo: "XXI", grupo: "Z80-Z99" },
  { codigo: "Z99.8", descripcion: "Dependencia de otras máquinas y aparatos que permiten la vida", capitulo: "XXI", grupo: "Z80-Z99" },
];

// ─── UPSERT batch ─────────────────────────────────────────────────────────────

const BATCH = 100;

/**
 * @param {import('pg').Client} client
 * @param {typeof FALLBACK_CODIGOS} codigos
 */
async function upsertBatch(client, codigos) {
  if (codigos.length === 0) return 0;

  // Construye VALUES placeholders: ($1,$2,$3,$4,$5), ($6,...) ...
  const vals = [];
  const params = [];
  let idx = 1;
  for (const c of codigos) {
    vals.push(`($${idx++},$${idx++},$${idx++},$${idx++},true)`);
    params.push(c.codigo, c.descripcion, c.capitulo ?? null, c.grupo ?? null);
  }

  const sql = `
    INSERT INTO public."Icd10Catalog" (codigo, descripcion, capitulo, grupo, activo)
    VALUES ${vals.join(",")}
    ON CONFLICT (codigo) DO NOTHING
  `;

  const res = await client.query(sql, params);
  return res.rowCount ?? 0;
}

async function main() {
  const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL o DIRECT_URL requerida.");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Intentar dataset completo desde disco; usar fallback si no existe.
    const fullDataset = loadFullDataset();
    const codigos = fullDataset ?? FALLBACK_CODIGOS;

    const modo = fullDataset ? "COMPLETO (dataset externo)" : "FALLBACK (~500 códigos críticos MINSAL SV)";
    console.log(`\nSeed CIE-10 — modo: ${modo}`);
    if (!fullDataset) {
      console.log("  Para el catálogo completo OMS (~14,000 codigos):");
      console.log("  1. Descargar desde https://www.who.int/standards/classifications/classification-of-diseases");
      console.log("  2. Guardar en packages/database/data/icd10_es_full.json");
      console.log("  3. Formato: [{\"codigo\":\"A00\",\"descripcion\":\"...\",\"capitulo\":\"I\",\"grupo\":\"A00-A09\"},...]\n");
    }

    console.log(`Total a procesar: ${codigos.length} códigos`);

    let totalInserted = 0;
    let totalSkipped = 0;
    let totalProcessed = 0;

    for (let i = 0; i < codigos.length; i += BATCH) {
      const batch = codigos.slice(i, i + BATCH);
      const inserted = await upsertBatch(client, batch);
      totalInserted += inserted;
      totalSkipped += batch.length - inserted;
      totalProcessed += batch.length;
      process.stdout.write(`  Procesados: ${totalProcessed}/${codigos.length}\r`);
    }

    console.log(`\n\nResultado:`);
    console.log(`  Insertados : ${totalInserted}`);
    console.log(`  Omitidos   : ${totalSkipped} (ya existían)`);
    console.log(`  Total      : ${totalProcessed}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\nError fatal:", err.message);
  process.exit(1);
});
