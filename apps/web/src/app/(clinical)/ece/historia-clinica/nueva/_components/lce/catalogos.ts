/**
 * Catálogos del formulario de Lesión de Causa Externa (REQ-ECE-LCE-001).
 * Literales tomados del mockup historia-clinica-lesion-causa-externa.html.
 *
 * `value` es la cadena canónica que se persiste (etiqueta legible). Las opciones
 * marcadas `otro` revelan un textarea de especificación (campo *Otro separado).
 */

export interface LceOpcion {
  num: string;
  value: string;
  otro?: boolean;
}

// II — Datos generales -------------------------------------------------------

export const TIPO_EVENTO: readonly LceOpcion[] = [
  { num: "1", value: "Desastre natural" },
  { num: "2", value: "Evento aislado" },
  { num: "3", value: "Guerra o conflicto armado" },
  { num: "4", value: "Terrorismo" },
  { num: "5", value: "No especificado" },
  { num: "6", value: "Otro", otro: true },
];

export const MECANISMO: readonly LceOpcion[] = [
  { num: "1", value: "Accidente de transporte" },
  { num: "2", value: "Agresión sexual" },
  { num: "3", value: "Asfixia o ahogamiento por inmersión" },
  { num: "4", value: "Caída" },
  { num: "5", value: "Contacto con cuerpo extraño" },
  { num: "6", value: "Contacto con electricidad" },
  { num: "7", value: "Disparo con arma de fuego" },
  { num: "8", value: "Estrangulación / ahorcamiento" },
  { num: "11", value: "Golpe / fuerza contundente" },
  { num: "14", value: "Puñalada, cortadura" },
  { num: "15", value: "No especificado" },
  { num: "16", value: "Otro", otro: true },
];

export const MEC_EXPLOSION: readonly LceOpcion[] = [
  { num: "a", value: "Minas" },
  { num: "b", value: "Otro artefacto explosivo" },
];

export const MEC_FUEGO: readonly LceOpcion[] = [
  { num: "a", value: "Fuego / humo / llama" },
  { num: "b", value: "Líquidos calientes" },
  { num: "c", value: "Pirotecnia" },
];

export const MEC_INTOXICACION: readonly LceOpcion[] = [
  { num: "a", value: "Fármaco" },
  { num: "b", value: "Plaguicidas" },
  { num: "c", value: "Hidrocarburos" },
  { num: "d", value: "Otro", otro: true },
];

export const MEC_MORDEDURA: readonly LceOpcion[] = [
  { num: "a", value: "Persona" },
  { num: "b", value: "Animal", otro: true },
];

export const INTENCIONALIDAD: readonly LceOpcion[] = [
  { num: "1", value: "No intencional (accidental)" },
  { num: "2", value: "Autoinfligida (suicidio / intento)" },
  { num: "3", value: "Intencional (agresión)" },
  { num: "4", value: "No especificada" },
  { num: "5", value: "Otros", otro: true },
];

export const LUGAR: readonly LceOpcion[] = [
  { num: "1", value: "Bar, cantina o similares" },
  { num: "2", value: "Calle" },
  { num: "3", value: "Casa / hogar" },
  { num: "4", value: "Escuela / lugar de estudio" },
  { num: "5", value: "Trabajo" },
  { num: "6", value: "No especificada" },
  { num: "7", value: "Otro", otro: true },
];

export const ACTIVIDAD: readonly LceOpcion[] = [
  { num: "1", value: "Estudiando" },
  { num: "2", value: "Practicando deporte" },
  { num: "3", value: "Recreación / descanso / juego" },
  { num: "4", value: "Tomando licor" },
  { num: "5", value: "Trabajando" },
  { num: "6", value: "Viajando (a un lugar o al trabajo)" },
  { num: "7", value: "No especificada" },
  { num: "8", value: "Otra", otro: true },
];

// III — Datos específicos ----------------------------------------------------

export const TRANSPORTE_VICTIMA: readonly LceOpcion[] = [
  { num: "1", value: "Automóvil" },
  { num: "2", value: "Bicicleta" },
  { num: "3", value: "Bus" },
  { num: "4", value: "Camión / rastra" },
  { num: "5", value: "Carreta / animal" },
  { num: "6", value: "Microbús" },
  { num: "7", value: "Motocicleta" },
  { num: "8", value: "Peatón" },
  { num: "9", value: "Pick up" },
  { num: "10", value: "Taxi" },
  { num: "11", value: "No especificado" },
  { num: "12", value: "Otro", otro: true },
];

export const CONTRAPARTE: readonly LceOpcion[] = [
  { num: "1", value: "Automóvil" },
  { num: "2", value: "Bicicleta" },
  { num: "3", value: "Bus" },
  { num: "4", value: "Camión / rastra" },
  { num: "5", value: "Carreta / animal" },
  { num: "6", value: "Microbús" },
  { num: "7", value: "Motocicleta" },
  { num: "8", value: "Objeto fijo" },
  { num: "9", value: "Peatón" },
  { num: "10", value: "Pick up" },
  { num: "11", value: "Taxi" },
  { num: "12", value: "No especificado" },
  { num: "13", value: "Otro", otro: true },
];

export const USUARIO_VIA: readonly LceOpcion[] = [
  { num: "1", value: "Conductor" },
  { num: "2", value: "Pasajero" },
  { num: "3", value: "Peatón" },
  { num: "4", value: "No especificado" },
];

export const TIPO_ACCIDENTE: readonly LceOpcion[] = [
  { num: "1", value: "Atropello" },
  { num: "2", value: "Colisión" },
  { num: "3", value: "Choque" },
  { num: "4", value: "Volcadura" },
  { num: "5", value: "No especificado" },
  { num: "6", value: "Otro", otro: true },
];

export const VIOLENCIA_RELACION: readonly LceOpcion[] = [
  { num: "1", value: "Pareja o ex pareja" },
  { num: "2", value: "Padres / padrastros" },
  { num: "3", value: "Otro familiar" },
  { num: "4", value: "Amigos / conocidos" },
  { num: "5", value: "Desconocido" },
  { num: "6", value: "No especificado" },
  { num: "7", value: "Otro", otro: true },
];

export const VIOLENCIA_CONTEXTO: readonly LceOpcion[] = [
  { num: "1", value: "Violencia intrafamiliar" },
  { num: "2", value: "Robo u otros crímenes" },
  { num: "3", value: "Otras riñas / peleas (no familiares)" },
  { num: "4", value: "Maras / pandillas" },
  { num: "5", value: "Bala perdida" },
  { num: "6", value: "No especificado" },
  { num: "7", value: "Otro", otro: true },
];

export const VIOLENCIA_AUTOINFLIGIDA: readonly LceOpcion[] = [
  { num: "1", value: "Víctima de abuso sexual o físico" },
  { num: "2", value: "Conflicto con la pareja o la familia" },
  { num: "3", value: "Enfermedad física" },
  { num: "4", value: "Desempleo" },
  { num: "5", value: "Dificultades escolares" },
  { num: "6", value: "Embarazo no deseado" },
  { num: "7", value: "Conducta adictiva" },
  { num: "8", value: "Conflicto con las amistades" },
  { num: "9", value: "Problemas con la justicia" },
  { num: "10", value: "Problemas financieros" },
  { num: "11", value: "No especificado" },
  { num: "12", value: "Otros", otro: true },
];

// IV — Datos clínicos --------------------------------------------------------

export const SEVERIDAD: readonly LceOpcion[] = [
  { num: "1", value: "Leve o superficial" },
  { num: "2", value: "Moderada" },
  { num: "3", value: "Severa" },
];

export const DESTINO: readonly LceOpcion[] = [
  { num: "1", value: "Abandono voluntario" },
  { num: "2", value: "Alta (manejo ambulatorio)" },
  { num: "3", value: "Fallecido en emergencia" },
  { num: "4", value: "Fuga" },
  { num: "5", value: "Hospitalizado" },
  { num: "6", value: "Referido a otro establecimiento" },
  { num: "7", value: "No especificado" },
];

/** Categoría Glasgow derivada del puntaje total (3–15). */
export type GlasgowCategoria = "Leve" | "Moderado" | "Severo";

export function glasgowCategoria(total: number | null | undefined): GlasgowCategoria | null {
  if (total == null || Number.isNaN(total)) return null;
  if (total >= 13) return "Leve";
  if (total >= 9) return "Moderado";
  return "Severo";
}
