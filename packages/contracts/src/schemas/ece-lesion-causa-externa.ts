/**
 * ECE — Formulario de Lesión de Causa Externa (REQ-ECE-LCE-001).
 *
 * Registro epidemiológico MINSAL ligado a un episodio de atención. Captura el
 * mecanismo, intencionalidad, datos específicos (transporte/violencia) y datos
 * clínicos (severidad, Glasgow, mapa corporal, destino) de una lesión.
 *
 * Multi-selects se persisten como text[] de etiquetas canónicas (ver catálogos
 * en apps/web …/_components/lce/catalogos.ts). Los campos "*Otro" complementan
 * la opción "Otro" de su catálogo. El mapa corporal es JSON [{key,label}].
 *
 * Estados: borrador → firmado. Al firmar se exige ≥1 mecanismo de la lesión.
 */
import { z } from "zod";

export const LCE_ESTADO = ["borrador", "firmado"] as const;
export const lceEstadoEnum = z.enum(LCE_ESTADO);
export type LceEstado = z.infer<typeof lceEstadoEnum>;

export const LCE_GLASGOW_CATEGORIA = ["Leve", "Moderado", "Severo"] as const;
export const lceGlasgowCategoriaEnum = z.enum(LCE_GLASGOW_CATEGORIA);
export type LceGlasgowCategoria = z.infer<typeof lceGlasgowCategoriaEnum>;

// Helpers de campo --------------------------------------------------------------

/** Lista de opciones de catálogo (etiquetas canónicas). */
const seleccion = () => z.array(z.string().min(1).max(200)).max(30).default([]);
/** Texto de especificación ("Otro"). */
const textoOtro = () => z.string().max(2000).optional();
/** Narrativa clínica. */
const narrativa = () => z.string().max(4000).optional();

/** Sitio anatómico marcado en el mapa corporal. */
export const lceSitioCorporalSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
});
export type LceSitioCorporal = z.infer<typeof lceSitioCorporalSchema>;

// Payload de datos clínicos (sin claves de identidad/episodio) -----------------

export const lceDatosSchema = z.object({
  // II — Datos generales
  eventoFechaHora: z.string().datetime({ offset: true }).optional(),
  discapacidad: z.boolean().nullable().optional(),
  tipoEvento: seleccion(),
  tipoEventoOtro: textoOtro(),
  lugarDepartamento: z.string().max(120).optional(),
  lugarMunicipio: z.string().max(120).optional(),
  lugarDireccion: z.string().max(500).optional(),
  mecanismo: seleccion(),
  mecanismoOtro: textoOtro(),
  mecExplosion: seleccion(),
  mecFuego: seleccion(),
  mecIntoxicacion: seleccion(),
  mecIntoxicacionOtro: textoOtro(),
  mecMordedura: seleccion(),
  mecMordeduraOtro: textoOtro(),
  intencionalidad: seleccion(),
  intencionalidadOtro: textoOtro(),
  lugar: seleccion(),
  lugarOtro: textoOtro(),
  actividad: seleccion(),
  actividadOtro: textoOtro(),

  // III — Datos específicos
  transporteVictima: seleccion(),
  transporteVictimaOtro: textoOtro(),
  contraparte: seleccion(),
  contraparteOtro: textoOtro(),
  usuarioVia: seleccion(),
  tipoAccidente: seleccion(),
  tipoAccidenteOtro: textoOtro(),
  violenciaRelacion: seleccion(),
  violenciaRelacionOtro: textoOtro(),
  violenciaContexto: seleccion(),
  violenciaContextoOtro: textoOtro(),
  violenciaAutoinfligida: seleccion(),
  violenciaAutoinfligidaOtro: textoOtro(),

  // IV — Datos clínicos
  severidad: seleccion(),
  glasgowTotal: z.number().int().min(3).max(15).nullable().optional(),
  glasgowCategoria: lceGlasgowCategoriaEnum.nullable().optional(),
  mapaCorporalSitios: z.array(lceSitioCorporalSchema).max(44).default([]),
  diagnosticoNaturaleza: narrativa(),
  sitioAnatomico: narrativa(),
  destino: seleccion(),
});
export type LceDatos = z.infer<typeof lceDatosSchema>;

// Inputs de procedimientos tRPC -------------------------------------------------

export const lceGetByEpisodioInput = z.object({
  episodioId: z.string().uuid(),
});

export const lceUpsertInput = z.object({
  episodioId: z.string().uuid(),
  pacienteId: z.string().uuid().optional(),
  datos: lceDatosSchema,
});
export type LceUpsertInput = z.infer<typeof lceUpsertInput>;

export const lceFirmarInput = z.object({
  id: z.string().uuid(),
});
