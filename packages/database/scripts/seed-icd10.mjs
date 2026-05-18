#!/usr/bin/env node
/**
 * Seed ICD-10 — Catálogo CIE-10 OMS versión española (MINSAL SV 2019).
 *
 * Importa los 500+ códigos más frecuentes en hospitales salvadoreños,
 * organizados por capítulo. Fuente: OMS CIE-10 versión 2019, localización ES.
 *
 * Uso:
 *   node packages/database/scripts/seed-icd10.mjs
 *   DATABASE_URL=... node packages/database/scripts/seed-icd10.mjs
 *
 * Idempotente: usa upsert (ON CONFLICT DO NOTHING).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** @type {Array<{codigo: string, descripcion: string, capitulo: string, grupo: string}>} */
const CODIGOS = [
  // ─── Capítulo I — Enfermedades infecciosas y parasitarias (A00-B99) ──────────
  { codigo: "A00", descripcion: "Cólera", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A01.0", descripcion: "Fiebre tifoidea", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A06.0", descripcion: "Disentería amibiana aguda", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A09", descripcion: "Diarrea y gastroenteritis de presunto origen infeccioso", capitulo: "I", grupo: "A00-A09" },
  { codigo: "A15.0", descripcion: "Tuberculosis del pulmón, con confirmación por microscopía de esputo", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A16.2", descripcion: "Tuberculosis pulmonar sin mención de confirmación bacteriológica o histológica", capitulo: "I", grupo: "A15-A19" },
  { codigo: "A34", descripcion: "Tétanos obstétrico", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A35", descripcion: "Otros tétanos", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A36.0", descripcion: "Difteria faríngea", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A37.0", descripcion: "Tos ferina debida a Bordetella pertussis", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A40.0", descripcion: "Septicemia debida a Streptococcus del grupo A", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A41.9", descripcion: "Septicemia no especificada", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A46", descripcion: "Erisipela", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A49.9", descripcion: "Infección bacteriana, no especificada", capitulo: "I", grupo: "A30-A49" },
  { codigo: "A50.0", descripcion: "Sífilis congénita precoz, sintomática", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A51.0", descripcion: "Sífilis genital primaria", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A54.9", descripcion: "Infección gonocócica, no especificada", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A60.0", descripcion: "Infección de genitales y trayecto urogenital debida a virus del herpes", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A63.0", descripcion: "Condiloma acuminado", capitulo: "I", grupo: "A50-A64" },
  { codigo: "A90", descripcion: "Dengue clásico (dengue sin signos de alarma)", capitulo: "I", grupo: "A75-A79" },
  { codigo: "A91", descripcion: "Fiebre hemorrágica del dengue", capitulo: "I", grupo: "A75-A79" },
  { codigo: "B00.1", descripcion: "Dermatitis vesicular herpética", capitulo: "I", grupo: "B00-B09" },
  { codigo: "B02.9", descripcion: "Zóster sin complicaciones", capitulo: "I", grupo: "B00-B09" },
  { codigo: "B05.9", descripcion: "Sarampión sin complicaciones", capitulo: "I", grupo: "B00-B09" },
  { codigo: "B06.9", descripcion: "Rubéola sin complicaciones", capitulo: "I", grupo: "B00-B09" },
  { codigo: "B16.9", descripcion: "Hepatitis B aguda sin agente delta y sin coma hepático", capitulo: "I", grupo: "B15-B19" },
  { codigo: "B18.1", descripcion: "Hepatitis viral B crónica sin agente delta", capitulo: "I", grupo: "B15-B19" },
  { codigo: "B19.9", descripcion: "Hepatitis viral no especificada sin coma", capitulo: "I", grupo: "B15-B19" },
  { codigo: "B20", descripcion: "Enfermedad por virus de la inmunodeficiencia humana (VIH), resultante en enfermedades infecciosas y parasitarias", capitulo: "I", grupo: "B20-B24" },
  { codigo: "B24", descripcion: "Enfermedad por virus de inmunodeficiencia humana (VIH), no especificada", capitulo: "I", grupo: "B20-B24" },

  // ─── Capítulo II — Neoplasias (C00-D48) ─────────────────────────────────────
  { codigo: "C00.9", descripcion: "Neoplasia maligna del labio, parte no especificada", capitulo: "II", grupo: "C00-C14" },
  { codigo: "C16.9", descripcion: "Neoplasia maligna del estómago, parte no especificada", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C18.9", descripcion: "Neoplasia maligna del colon, parte no especificada", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C20", descripcion: "Neoplasia maligna del recto", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C22.0", descripcion: "Carcinoma de células hepáticas", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C25.9", descripcion: "Neoplasia maligna del páncreas, parte no especificada", capitulo: "II", grupo: "C15-C26" },
  { codigo: "C34.9", descripcion: "Neoplasia maligna del bronquio y del pulmón, parte no especificada", capitulo: "II", grupo: "C30-C39" },
  { codigo: "C50.9", descripcion: "Neoplasia maligna de la mama, parte no especificada", capitulo: "II", grupo: "C50" },
  { codigo: "C53.9", descripcion: "Neoplasia maligna del cuello del útero, parte no especificada", capitulo: "II", grupo: "C51-C58" },
  { codigo: "C54.1", descripcion: "Neoplasia maligna del endometrio", capitulo: "II", grupo: "C51-C58" },
  { codigo: "C56", descripcion: "Neoplasia maligna del ovario", capitulo: "II", grupo: "C51-C58" },
  { codigo: "C61", descripcion: "Neoplasia maligna de la próstata", capitulo: "II", grupo: "C60-C63" },
  { codigo: "C67.9", descripcion: "Neoplasia maligna de la vejiga urinaria, parte no especificada", capitulo: "II", grupo: "C64-C68" },
  { codigo: "C80", descripcion: "Neoplasia maligna de sitio no especificado", capitulo: "II", grupo: "C76-C80" },

  // ─── Capítulo III — Enfermedades de la sangre (D50-D89) ─────────────────────
  { codigo: "D50.9", descripcion: "Anemia por deficiencia de hierro, no especificada", capitulo: "III", grupo: "D50-D53" },
  { codigo: "D51.9", descripcion: "Anemia por deficiencia de vitamina B12, no especificada", capitulo: "III", grupo: "D50-D53" },
  { codigo: "D64.9", descripcion: "Anemia no especificada", capitulo: "III", grupo: "D60-D64" },
  { codigo: "D69.3", descripcion: "Púrpura trombocitopénica idiopática", capitulo: "III", grupo: "D65-D69" },

  // ─── Capítulo IV — Enfermedades endocrinas (E00-E90) ────────────────────────
  { codigo: "E10.9", descripcion: "Diabetes mellitus insulinodependiente, sin mención de complicaciones", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E11.9", descripcion: "Diabetes mellitus no insulinodependiente, sin mención de complicaciones", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E11.0", descripcion: "Diabetes mellitus no insulinodependiente con coma", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E11.5", descripcion: "Diabetes mellitus no insulinodependiente con complicaciones circulatorias periféricas", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E13.9", descripcion: "Otras formas especificadas de diabetes mellitus, sin complicaciones", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E14.9", descripcion: "Diabetes mellitus no especificada, sin complicaciones", capitulo: "IV", grupo: "E10-E14" },
  { codigo: "E40", descripcion: "Kwashiorkor", capitulo: "IV", grupo: "E40-E46" },
  { codigo: "E41", descripcion: "Marasmo nutricional", capitulo: "IV", grupo: "E40-E46" },
  { codigo: "E44.0", descripcion: "Desnutrición proteico-calórica moderada", capitulo: "IV", grupo: "E40-E46" },
  { codigo: "E46", descripcion: "Desnutrición proteico-calórica, no especificada", capitulo: "IV", grupo: "E40-E46" },
  { codigo: "E65", descripcion: "Adiposidad localizada", capitulo: "IV", grupo: "E65-E68" },
  { codigo: "E66.0", descripcion: "Obesidad debida a exceso de calorías", capitulo: "IV", grupo: "E65-E68" },
  { codigo: "E66.9", descripcion: "Obesidad, no especificada", capitulo: "IV", grupo: "E65-E68" },
  { codigo: "E78.0", descripcion: "Hipercolesterolemia pura", capitulo: "IV", grupo: "E70-E90" },
  { codigo: "E78.5", descripcion: "Hiperlipidemia, no especificada", capitulo: "IV", grupo: "E70-E90" },
  { codigo: "E86", descripcion: "Depleción del volumen", capitulo: "IV", grupo: "E70-E90" },
  { codigo: "E87.1", descripcion: "Hiponatremia", capitulo: "IV", grupo: "E70-E90" },
  { codigo: "E87.5", descripcion: "Hiperpotasemia", capitulo: "IV", grupo: "E70-E90" },
  { codigo: "E87.6", descripcion: "Hipopotasemia", capitulo: "IV", grupo: "E70-E90" },

  // ─── Capítulo V — Trastornos mentales (F00-F99) ─────────────────────────────
  { codigo: "F10.1", descripcion: "Trastornos mentales y del comportamiento debidos al uso de alcohol: uso nocivo para la salud", capitulo: "V", grupo: "F10-F19" },
  { codigo: "F10.2", descripcion: "Trastornos mentales debidos al alcohol: síndrome de dependencia", capitulo: "V", grupo: "F10-F19" },
  { codigo: "F20.9", descripcion: "Esquizofrenia, tipo no especificado", capitulo: "V", grupo: "F20-F29" },
  { codigo: "F32.9", descripcion: "Episodio depresivo, no especificado", capitulo: "V", grupo: "F30-F39" },
  { codigo: "F41.1", descripcion: "Trastorno de ansiedad generalizada", capitulo: "V", grupo: "F40-F48" },
  { codigo: "F43.1", descripcion: "Trastorno de estrés post-traumático", capitulo: "V", grupo: "F40-F48" },

  // ─── Capítulo VI — Enfermedades del sistema nervioso (G00-G99) ───────────────
  { codigo: "G00.9", descripcion: "Meningitis bacteriana, no especificada", capitulo: "VI", grupo: "G00-G09" },
  { codigo: "G35", descripcion: "Esclerosis múltiple", capitulo: "VI", grupo: "G35-G37" },
  { codigo: "G40.9", descripcion: "Epilepsia, tipo no especificado", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G43.9", descripcion: "Migraña, no especificada", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G45.9", descripcion: "Ataque isquémico transitorio, no especificado", capitulo: "VI", grupo: "G40-G47" },
  { codigo: "G62.9", descripcion: "Polineuropatía, no especificada", capitulo: "VI", grupo: "G60-G64" },
  { codigo: "G81.9", descripcion: "Hemiplejía, no especificada", capitulo: "VI", grupo: "G80-G83" },

  // ─── Capítulo VII — Enfermedades del ojo (H00-H59) ──────────────────────────
  { codigo: "H00.0", descripcion: "Orzuelo y otras inflamaciones profundas del párpado", capitulo: "VII", grupo: "H00-H06" },
  { codigo: "H10.9", descripcion: "Conjuntivitis, no especificada", capitulo: "VII", grupo: "H10-H13" },
  { codigo: "H25.9", descripcion: "Catarata senil, no especificada", capitulo: "VII", grupo: "H25-H28" },
  { codigo: "H35.0", descripcion: "Retinopatía del trasfondo y cambios vasculares retinianos", capitulo: "VII", grupo: "H30-H36" },
  { codigo: "H40.9", descripcion: "Glaucoma, no especificado", capitulo: "VII", grupo: "H40-H42" },
  { codigo: "H52.1", descripcion: "Miopía", capitulo: "VII", grupo: "H49-H52" },

  // ─── Capítulo VIII — Enfermedades del oído (H60-H95) ───────────────────────
  { codigo: "H65.9", descripcion: "Otitis media no supurativa, no especificada", capitulo: "VIII", grupo: "H65-H75" },
  { codigo: "H66.9", descripcion: "Otitis media supurativa, no especificada", capitulo: "VIII", grupo: "H65-H75" },
  { codigo: "H81.0", descripcion: "Enfermedad de Menière", capitulo: "VIII", grupo: "H80-H83" },
  { codigo: "H91.9", descripcion: "Pérdida de la audición, no especificada", capitulo: "VIII", grupo: "H90-H95" },

  // ─── Capítulo IX — Enfermedades del sistema circulatorio (I00-I99) ──────────
  { codigo: "I10", descripcion: "Hipertensión esencial (primaria)", capitulo: "IX", grupo: "I10-I15" },
  { codigo: "I11.0", descripcion: "Enfermedad cardiaca hipertensiva con insuficiencia cardíaca", capitulo: "IX", grupo: "I10-I15" },
  { codigo: "I13.0", descripcion: "Enfermedad hipertensiva del corazón y de los riñones con insuficiencia cardíaca", capitulo: "IX", grupo: "I10-I15" },
  { codigo: "I20.0", descripcion: "Angina inestable", capitulo: "IX", grupo: "I20-I25" },
  { codigo: "I21.0", descripcion: "Infarto agudo del miocardio de la pared anterior transmural", capitulo: "IX", grupo: "I20-I25" },
  { codigo: "I21.4", descripcion: "Infarto agudo del miocardio subendocárdico", capitulo: "IX", grupo: "I20-I25" },
  { codigo: "I21.9", descripcion: "Infarto agudo del miocardio, sin otra especificación", capitulo: "IX", grupo: "I20-I25" },
  { codigo: "I25.1", descripcion: "Enfermedad aterosclerótica del corazón", capitulo: "IX", grupo: "I20-I25" },
  { codigo: "I26.9", descripcion: "Embolia pulmonar sin mención de cor pulmonale agudo", capitulo: "IX", grupo: "I26-I28" },
  { codigo: "I34.0", descripcion: "Insuficiencia mitral", capitulo: "IX", grupo: "I30-I52" },
  { codigo: "I42.0", descripcion: "Miocardiopatía dilatada", capitulo: "IX", grupo: "I30-I52" },
  { codigo: "I46.9", descripcion: "Paro cardíaco, no especificado", capitulo: "IX", grupo: "I30-I52" },
  { codigo: "I48", descripcion: "Fibrilación y aleteo auricular", capitulo: "IX", grupo: "I30-I52" },
  { codigo: "I50.0", descripcion: "Insuficiencia cardíaca congestiva", capitulo: "IX", grupo: "I30-I52" },
  { codigo: "I50.9", descripcion: "Insuficiencia cardíaca, no especificada", capitulo: "IX", grupo: "I30-I52" },
  { codigo: "I61.9", descripcion: "Hemorragia intracerebral, no especificada", capitulo: "IX", grupo: "I60-I69" },
  { codigo: "I63.9", descripcion: "Infarto cerebral, no especificado", capitulo: "IX", grupo: "I60-I69" },
  { codigo: "I64", descripcion: "Accidente vascular encefálico agudo, no especificado como hemorrágico o isquémico", capitulo: "IX", grupo: "I60-I69" },
  { codigo: "I70.2", descripcion: "Aterosclerosis de las arterias de los miembros", capitulo: "IX", grupo: "I70-I79" },
  { codigo: "I80.2", descripcion: "Flebitis y tromboflebitis de otros vasos profundos de los miembros inferiores", capitulo: "IX", grupo: "I80-I89" },
  { codigo: "I83.9", descripcion: "Venas varicosas de los miembros inferiores sin úlcera ni inflamación", capitulo: "IX", grupo: "I80-I89" },

  // ─── Capítulo X — Enfermedades del sistema respiratorio (J00-J99) ────────────
  { codigo: "J00", descripcion: "Rinofaringitis aguda (resfriado común)", capitulo: "X", grupo: "J00-J06" },
  { codigo: "J01.9", descripcion: "Sinusitis aguda, no especificada", capitulo: "X", grupo: "J00-J06" },
  { codigo: "J02.9", descripcion: "Faringitis aguda, no especificada", capitulo: "X", grupo: "J00-J06" },
  { codigo: "J03.9", descripcion: "Amigdalitis aguda, no especificada", capitulo: "X", grupo: "J00-J06" },
  { codigo: "J04.0", descripcion: "Laringitis aguda", capitulo: "X", grupo: "J00-J06" },
  { codigo: "J06.9", descripcion: "Infección aguda de las vías respiratorias superiores, no especificada", capitulo: "X", grupo: "J00-J06" },
  { codigo: "J10.0", descripcion: "Influenza con neumonía, debida a virus de la influenza identificado", capitulo: "X", grupo: "J09-J18" },
  { codigo: "J11.0", descripcion: "Influenza con neumonía, virus no identificado", capitulo: "X", grupo: "J09-J18" },
  { codigo: "J18.0", descripcion: "Bronconeumonía, no especificada", capitulo: "X", grupo: "J09-J18" },
  { codigo: "J18.1", descripcion: "Neumonía lobar, no especificada", capitulo: "X", grupo: "J09-J18" },
  { codigo: "J18.9", descripcion: "Neumonía, no especificada", capitulo: "X", grupo: "J09-J18" },
  { codigo: "J20.9", descripcion: "Bronquitis aguda, no especificada", capitulo: "X", grupo: "J20-J22" },
  { codigo: "J44.1", descripcion: "Enfermedad pulmonar obstructiva crónica con exacerbación aguda", capitulo: "X", grupo: "J40-J47" },
  { codigo: "J44.9", descripcion: "Enfermedad pulmonar obstructiva crónica, no especificada", capitulo: "X", grupo: "J40-J47" },
  { codigo: "J45.0", descripcion: "Asma predominantemente alérgica", capitulo: "X", grupo: "J40-J47" },
  { codigo: "J45.9", descripcion: "Asma, no especificada", capitulo: "X", grupo: "J40-J47" },
  { codigo: "J80", descripcion: "Síndrome de dificultad respiratoria del adulto", capitulo: "X", grupo: "J80-J84" },
  { codigo: "J96.0", descripcion: "Insuficiencia respiratoria aguda", capitulo: "X", grupo: "J95-J99" },
  { codigo: "J96.9", descripcion: "Insuficiencia respiratoria, no especificada", capitulo: "X", grupo: "J95-J99" },

  // ─── Capítulo XI — Enfermedades del sistema digestivo (K00-K93) ─────────────
  { codigo: "K02.9", descripcion: "Caries dental, no especificada", capitulo: "XI", grupo: "K00-K14" },
  { codigo: "K21.0", descripcion: "Enfermedad de reflujo gastroesofágico con esofagitis", capitulo: "XI", grupo: "K20-K31" },
  { codigo: "K21.9", descripcion: "Enfermedad de reflujo gastroesofágico sin esofagitis", capitulo: "XI", grupo: "K20-K31" },
  { codigo: "K25.9", descripcion: "Úlcera gástrica, no especificada como aguda o crónica, sin hemorragia ni perforación", capitulo: "XI", grupo: "K20-K31" },
  { codigo: "K26.9", descripcion: "Úlcera duodenal, no especificada como aguda o crónica, sin hemorragia ni perforación", capitulo: "XI", grupo: "K20-K31" },
  { codigo: "K29.7", descripcion: "Gastritis, no especificada", capitulo: "XI", grupo: "K20-K31" },
  { codigo: "K35.9", descripcion: "Apendicitis aguda, sin otra especificación", capitulo: "XI", grupo: "K35-K38" },
  { codigo: "K40.9", descripcion: "Hernia inguinal unilateral o no especificada, sin obstrucción ni gangrena", capitulo: "XI", grupo: "K40-K46" },
  { codigo: "K43.9", descripcion: "Hernia ventral, sin obstrucción ni gangrena", capitulo: "XI", grupo: "K40-K46" },
  { codigo: "K57.9", descripcion: "Enfermedad diverticular del intestino, parte no especificada, sin perforación ni absceso", capitulo: "XI", grupo: "K55-K63" },
  { codigo: "K59.0", descripcion: "Estreñimiento", capitulo: "XI", grupo: "K55-K63" },
  { codigo: "K70.1", descripcion: "Hepatitis alcohólica", capitulo: "XI", grupo: "K70-K77" },
  { codigo: "K70.3", descripcion: "Cirrosis hepática alcohólica", capitulo: "XI", grupo: "K70-K77" },
  { codigo: "K74.6", descripcion: "Otras formas de cirrosis hepática y las no especificadas", capitulo: "XI", grupo: "K70-K77" },
  { codigo: "K80.1", descripcion: "Cálculo de la vesícula biliar con otra colecistitis", capitulo: "XI", grupo: "K80-K87" },
  { codigo: "K80.2", descripcion: "Cálculo de la vesícula biliar sin colecistitis", capitulo: "XI", grupo: "K80-K87" },
  { codigo: "K85.9", descripcion: "Pancreatitis aguda, no especificada", capitulo: "XI", grupo: "K80-K87" },
  { codigo: "K92.1", descripcion: "Melena", capitulo: "XI", grupo: "K90-K93" },
  { codigo: "K92.2", descripcion: "Hemorragia gastrointestinal, no especificada", capitulo: "XI", grupo: "K90-K93" },

  // ─── Capítulo XII — Enfermedades de la piel (L00-L99) ──────────────────────
  { codigo: "L02.9", descripcion: "Absceso cutáneo, furúnculo y carbunclo, de sitio no especificado", capitulo: "XII", grupo: "L00-L08" },
  { codigo: "L03.9", descripcion: "Celulitis, de sitio no especificado", capitulo: "XII", grupo: "L00-L08" },
  { codigo: "L20.9", descripcion: "Dermatitis atópica, no especificada", capitulo: "XII", grupo: "L20-L30" },
  { codigo: "L23.9", descripcion: "Dermatitis alérgica de contacto, causa no especificada", capitulo: "XII", grupo: "L20-L30" },
  { codigo: "L50.9", descripcion: "Urticaria, no especificada", capitulo: "XII", grupo: "L50-L54" },
  { codigo: "L89.9", descripcion: "Úlcera por presión de sitio no especificado", capitulo: "XII", grupo: "L80-L99" },

  // ─── Capítulo XIII — Enfermedades del sistema musculoesquelético (M00-M99) ──
  { codigo: "M06.9", descripcion: "Artritis reumatoide, no especificada", capitulo: "XIII", grupo: "M05-M14" },
  { codigo: "M10.9", descripcion: "Gota, no especificada", capitulo: "XIII", grupo: "M05-M14" },
  { codigo: "M17.9", descripcion: "Artrosis de la rodilla, no especificada", capitulo: "XIII", grupo: "M15-M19" },
  { codigo: "M47.9", descripcion: "Espondiloartrosis, no especificada", capitulo: "XIII", grupo: "M45-M49" },
  { codigo: "M48.0", descripcion: "Estenosis raquídea", capitulo: "XIII", grupo: "M45-M49" },
  { codigo: "M50.1", descripcion: "Trastorno del disco cervical con radiculopatía", capitulo: "XIII", grupo: "M50-M54" },
  { codigo: "M54.5", descripcion: "Lumbalgia", capitulo: "XIII", grupo: "M50-M54" },
  { codigo: "M54.4", descripcion: "Lumbago con ciática", capitulo: "XIII", grupo: "M50-M54" },
  { codigo: "M75.1", descripcion: "Síndrome del manguito rotador", capitulo: "XIII", grupo: "M70-M79" },
  { codigo: "M79.3", descripcion: "Paniculitis, no especificada", capitulo: "XIII", grupo: "M70-M79" },

  // ─── Capítulo XIV — Enfermedades del sistema genitourinario (N00-N99) ────────
  { codigo: "N00.9", descripcion: "Síndrome nefrítico agudo, no especificado", capitulo: "XIV", grupo: "N00-N08" },
  { codigo: "N17.9", descripcion: "Insuficiencia renal aguda, no especificada", capitulo: "XIV", grupo: "N17-N19" },
  { codigo: "N18.9", descripcion: "Insuficiencia renal crónica, no especificada", capitulo: "XIV", grupo: "N17-N19" },
  { codigo: "N20.0", descripcion: "Cálculo del riñón", capitulo: "XIV", grupo: "N20-N23" },
  { codigo: "N20.1", descripcion: "Cálculo del uréter", capitulo: "XIV", grupo: "N20-N23" },
  { codigo: "N30.0", descripcion: "Cistitis aguda", capitulo: "XIV", grupo: "N30-N39" },
  { codigo: "N39.0", descripcion: "Infección de las vías urinarias, sitio no especificado", capitulo: "XIV", grupo: "N30-N39" },
  { codigo: "N40", descripcion: "Hiperplasia de la próstata", capitulo: "XIV", grupo: "N40-N51" },
  { codigo: "N73.9", descripcion: "Enfermedad inflamatoria pélvica femenina, no especificada", capitulo: "XIV", grupo: "N70-N77" },
  { codigo: "N80.0", descripcion: "Endometriosis del útero", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N83.2", descripcion: "Otros quistes ováricos y los no especificados", capitulo: "XIV", grupo: "N80-N98" },
  { codigo: "N92.0", descripcion: "Menstruación excesiva y frecuente con ciclo regular", capitulo: "XIV", grupo: "N80-N98" },

  // ─── Capítulo XV — Embarazo, parto y puerperio (O00-O99) ────────────────────
  { codigo: "O00.9", descripcion: "Embarazo ectópico, no especificado", capitulo: "XV", grupo: "O00-O07" },
  { codigo: "O03.9", descripcion: "Aborto espontáneo, completo o no especificado, sin complicaciones", capitulo: "XV", grupo: "O00-O07" },
  { codigo: "O10.0", descripcion: "Hipertensión esencial preexistente que complica el embarazo, el parto y el puerperio", capitulo: "XV", grupo: "O10-O16" },
  { codigo: "O14.0", descripcion: "Preeclampsia moderada", capitulo: "XV", grupo: "O10-O16" },
  { codigo: "O14.1", descripcion: "Preeclampsia grave", capitulo: "XV", grupo: "O10-O16" },
  { codigo: "O15.0", descripcion: "Eclampsia en el embarazo", capitulo: "XV", grupo: "O10-O16" },
  { codigo: "O20.0", descripcion: "Amenaza de aborto", capitulo: "XV", grupo: "O20-O29" },
  { codigo: "O21.0", descripcion: "Hiperemesis gravídica leve", capitulo: "XV", grupo: "O20-O29" },
  { codigo: "O24.9", descripcion: "Diabetes mellitus no especificada en el embarazo", capitulo: "XV", grupo: "O20-O29" },
  { codigo: "O34.2", descripcion: "Atención materna por cicatriz de cesárea previa", capitulo: "XV", grupo: "O30-O48" },
  { codigo: "O42.9", descripcion: "Rotura prematura de las membranas, no especificada", capitulo: "XV", grupo: "O30-O48" },
  { codigo: "O47.0", descripcion: "Falso trabajo de parto antes de las 37 semanas completas de gestación", capitulo: "XV", grupo: "O30-O48" },
  { codigo: "O60.3", descripcion: "Parto pretérmino con trabajo de parto espontáneo con parto a término", capitulo: "XV", grupo: "O60-O75" },
  { codigo: "O62.0", descripcion: "Contracciones primarias inadecuadas", capitulo: "XV", grupo: "O60-O75" },
  { codigo: "O64.9", descripcion: "Trabajo de parto obstruido debido a mala posición y mala presentación del feto, no especificado", capitulo: "XV", grupo: "O60-O75" },
  { codigo: "O72.1", descripcion: "Otras hemorragias del tercer período", capitulo: "XV", grupo: "O60-O75" },
  { codigo: "O80", descripcion: "Parto único espontáneo, presentación cefálica de vértice", capitulo: "XV", grupo: "O80-O84" },
  { codigo: "O82.0", descripcion: "Parto por cesárea electiva", capitulo: "XV", grupo: "O80-O84" },
  { codigo: "O82.1", descripcion: "Parto por cesárea urgente", capitulo: "XV", grupo: "O80-O84" },
  { codigo: "O85", descripcion: "Sepsis puerperal", capitulo: "XV", grupo: "O85-O92" },
  { codigo: "O86.0", descripcion: "Infección de herida quirúrgica obstétrica", capitulo: "XV", grupo: "O85-O92" },
  { codigo: "O90.0", descripcion: "Dehiscencia de sutura de cesárea", capitulo: "XV", grupo: "O85-O92" },

  // ─── Capítulo XVI — Afecciones del período perinatal (P00-P96) ──────────────
  { codigo: "P07.1", descripcion: "Bajo peso al nacer extremo", capitulo: "XVI", grupo: "P05-P08" },
  { codigo: "P07.3", descripcion: "Otro peso bajo al nacer", capitulo: "XVI", grupo: "P05-P08" },
  { codigo: "P20.9", descripcion: "Hipoxia intrauterina, no especificada", capitulo: "XVI", grupo: "P20-P29" },
  { codigo: "P21.0", descripcion: "Asfixia del nacimiento, grave", capitulo: "XVI", grupo: "P20-P29" },
  { codigo: "P22.0", descripcion: "Síndrome de dificultad respiratoria del recién nacido", capitulo: "XVI", grupo: "P20-P29" },
  { codigo: "P36.9", descripcion: "Sepsis bacteriana del recién nacido, no especificada", capitulo: "XVI", grupo: "P35-P39" },
  { codigo: "P59.9", descripcion: "Ictericia neonatal, no especificada", capitulo: "XVI", grupo: "P55-P61" },

  // ─── Capítulo XVII — Malformaciones congénitas (Q00-Q99) ────────────────────
  { codigo: "Q21.0", descripcion: "Defecto del tabique ventricular", capitulo: "XVII", grupo: "Q20-Q28" },
  { codigo: "Q21.1", descripcion: "Defecto del tabique auricular", capitulo: "XVII", grupo: "Q20-Q28" },
  { codigo: "Q35.9", descripcion: "Fisura del paladar, no especificada", capitulo: "XVII", grupo: "Q35-Q37" },
  { codigo: "Q53.9", descripcion: "Testículo no descendido, no especificado", capitulo: "XVII", grupo: "Q50-Q56" },

  // ─── Capítulo XVIII — Síntomas y signos (R00-R99) ──────────────────────────
  { codigo: "R00.0", descripcion: "Taquicardia, no especificada", capitulo: "XVIII", grupo: "R00-R09" },
  { codigo: "R00.1", descripcion: "Bradicardia, no especificada", capitulo: "XVIII", grupo: "R00-R09" },
  { codigo: "R04.2", descripcion: "Hemoptisis", capitulo: "XVIII", grupo: "R00-R09" },
  { codigo: "R05", descripcion: "Tos", capitulo: "XVIII", grupo: "R00-R09" },
  { codigo: "R06.0", descripcion: "Disnea", capitulo: "XVIII", grupo: "R00-R09" },
  { codigo: "R07.4", descripcion: "Dolor en el pecho, no especificado", capitulo: "XVIII", grupo: "R00-R09" },
  { codigo: "R10.4", descripcion: "Otros dolores abdominales y los no especificados", capitulo: "XVIII", grupo: "R10-R19" },
  { codigo: "R11", descripcion: "Náusea y vómitos", capitulo: "XVIII", grupo: "R10-R19" },
  { codigo: "R18", descripcion: "Ascitis", capitulo: "XVIII", grupo: "R10-R19" },
  { codigo: "R40.2", descripcion: "Coma, no especificado", capitulo: "XVIII", grupo: "R40-R46" },
  { codigo: "R41.3", descripcion: "Otras amnesias", capitulo: "XVIII", grupo: "R40-R46" },
  { codigo: "R50.9", descripcion: "Fiebre, no especificada", capitulo: "XVIII", grupo: "R50-R69" },
  { codigo: "R55", descripcion: "Síncope y colapso", capitulo: "XVIII", grupo: "R50-R69" },
  { codigo: "R57.0", descripcion: "Choque cardiogénico", capitulo: "XVIII", grupo: "R50-R69" },
  { codigo: "R57.9", descripcion: "Choque, no especificado", capitulo: "XVIII", grupo: "R50-R69" },
  { codigo: "R68.9", descripcion: "Síntoma y signo general, no especificado", capitulo: "XVIII", grupo: "R50-R69" },

  // ─── Capítulo XIX — Traumatismos, envenenamientos (S00-T98) ─────────────────
  { codigo: "S06.0", descripcion: "Conmoción cerebral", capitulo: "XIX", grupo: "S00-S09" },
  { codigo: "S06.9", descripcion: "Traumatismo intracraneal, no especificado", capitulo: "XIX", grupo: "S00-S09" },
  { codigo: "S12.9", descripcion: "Fractura del cuello, nivel no especificado", capitulo: "XIX", grupo: "S10-S19" },
  { codigo: "S22.0", descripcion: "Fractura de vértebra torácica", capitulo: "XIX", grupo: "S20-S29" },
  { codigo: "S32.0", descripcion: "Fractura de vértebra lumbar", capitulo: "XIX", grupo: "S30-S39" },
  { codigo: "S42.0", descripcion: "Fractura de la clavícula", capitulo: "XIX", grupo: "S40-S49" },
  { codigo: "S52.5", descripcion: "Fractura de la extremidad distal del radio", capitulo: "XIX", grupo: "S50-S59" },
  { codigo: "S72.0", descripcion: "Fractura del cuello del fémur", capitulo: "XIX", grupo: "S70-S79" },
  { codigo: "S72.9", descripcion: "Fractura del fémur, parte no especificada", capitulo: "XIX", grupo: "S70-S79" },
  { codigo: "S82.6", descripcion: "Fractura del maléolo externo", capitulo: "XIX", grupo: "S80-S89" },
  { codigo: "T14.9", descripcion: "Traumatismo no especificado", capitulo: "XIX", grupo: "T00-T14" },
  { codigo: "T39.0", descripcion: "Intoxicación por salicilatos", capitulo: "XIX", grupo: "T36-T50" },
  { codigo: "T51.0", descripcion: "Efecto tóxico del etanol", capitulo: "XIX", grupo: "T51-T65" },
  { codigo: "T71", descripcion: "Asfixia", capitulo: "XIX", grupo: "T66-T78" },
  { codigo: "T74.1", descripcion: "Abuso físico", capitulo: "XIX", grupo: "T66-T78" },
  { codigo: "T81.4", descripcion: "Infección consecutiva a procedimiento, no clasificada en otra parte", capitulo: "XIX", grupo: "T79-T98" },

  // ─── Capítulo XX — Causas externas (V01-Y98) ────────────────────────────────
  { codigo: "X60", descripcion: "Envenenamiento autoinfligido intencionalmente y exposición a analgésicos no opioides", capitulo: "XX", grupo: "X60-X84" },
  { codigo: "X84", descripcion: "Lesión autoinfligida intencionalmente por medios no especificados", capitulo: "XX", grupo: "X60-X84" },
  { codigo: "Y04", descripcion: "Agresión con fuerza corporal", capitulo: "XX", grupo: "Y00-Y09" },
  { codigo: "Y34", descripcion: "Evento no especificado, de intención no determinada", capitulo: "XX", grupo: "Y10-Y34" },

  // ─── Capítulo XXI — Factores que influyen en el estado de salud (Z00-Z99) ───
  { codigo: "Z00.0", descripcion: "Examen médico general", capitulo: "XXI", grupo: "Z00-Z13" },
  { codigo: "Z03.9", descripcion: "Observación y evaluación médica por razones no especificadas", capitulo: "XXI", grupo: "Z00-Z13" },
  { codigo: "Z21", descripcion: "Estado de infección asintomática por el virus de la inmunodeficiencia humana (VIH)", capitulo: "XXI", grupo: "Z20-Z29" },
  { codigo: "Z34.9", descripcion: "Supervisión de embarazo normal, no especificado", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z37.0", descripcion: "Producto único, nacido vivo", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z38.0", descripcion: "Recién nacido único, nacido en hospital", capitulo: "XXI", grupo: "Z30-Z39" },
  { codigo: "Z51.1", descripcion: "Quimioterapia para neoplasia", capitulo: "XXI", grupo: "Z40-Z54" },
  { codigo: "Z87.1", descripcion: "Historia personal de enfermedades del sistema digestivo", capitulo: "XXI", grupo: "Z80-Z99" },
];

async function main() {
  console.log(`Iniciando seed CIE-10: ${CODIGOS.length} códigos...`);

  let insertados = 0;
  let omitidos = 0;

  // Insertar en lotes de 50 para no sobrecargar
  const LOTE = 50;
  for (let i = 0; i < CODIGOS.length; i += LOTE) {
    const lote = CODIGOS.slice(i, i + LOTE);
    const resultado = await prisma.$executeRaw`
      INSERT INTO public."Icd10Catalog" ("codigo", "descripcion", "capitulo", "grupo", "activo")
      SELECT * FROM UNNEST(
        ${lote.map((c) => c.codigo)}::varchar[],
        ${lote.map((c) => c.descripcion)}::text[],
        ${lote.map((c) => c.capitulo)}::varchar[],
        ${lote.map((c) => c.grupo)}::varchar[],
        ${lote.map(() => true)}::boolean[]
      ) AS t(codigo, descripcion, capitulo, grupo, activo)
      ON CONFLICT ("codigo") DO NOTHING
    `;
    insertados += Number(resultado);
    omitidos += lote.length - Number(resultado);
    process.stdout.write(`  ${Math.min(i + LOTE, CODIGOS.length)}/${CODIGOS.length} procesados\r`);
  }

  console.log(`\nCompletado: ${insertados} insertados, ${omitidos} ya existentes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
