/**
 * Diccionario centralizado de abreviaturas usadas en el HIS.
 *
 * Cuando aparezca cualquiera de estos términos en la UI, debe envolverse
 * con `<Abbr term="..."/>` para que muestre un tooltip con su significado
 * en español (y en inglés cuando el término es originalmente inglés).
 *
 * Convención del shape:
 *   { es: "Significado en español", en?: "Original English meaning" }
 *
 * `en` se omite cuando la abreviatura es originalmente en español (DUI,
 * NIT, etc.).
 */

export interface AbbrDefinition {
  /** Significado en español — siempre presente. */
  es: string;
  /** Significado original en inglés, si la abreviatura viene del inglés. */
  en?: string;
  /** Categoría (para filtros futuros / docs). */
  category?:
    | "tech"
    | "clinical"
    | "regulatory"
    | "identification"
    | "gs1"
    | "auth";
}

export const ABBREVIATIONS: Record<string, AbbrDefinition> = {
  // ───────────────────────────── Identificación (SV) ─────────────────────
  DUI: {
    es: "Documento Único de Identidad — identificación oficial obligatoria para nacionales de El Salvador mayores de 18 años.",
    category: "identification",
  },
  NIT: {
    es: "Número de Identificación Tributaria — registro fiscal del contribuyente en El Salvador.",
    category: "identification",
  },
  NIE: {
    es: "Número de Identificación de Extranjero — identificación de residentes extranjeros en El Salvador.",
    category: "identification",
  },
  NUP: {
    es: "Número Único Personal — identificador único asignado por la Dirección General del Registro del Estado Familiar.",
    category: "identification",
  },
  MRN: {
    es: "Número de Registro Médico interno del hospital. Identifica al paciente dentro del HIS.",
    en: "Medical Record Number",
    category: "identification",
  },

  // ───────────────────────────── Sistemas / Tech ─────────────────────────
  HIS: {
    es: "Sistema de Información Hospitalaria",
    en: "Hospital Information System",
    category: "tech",
  },
  UUID: {
    es: "Identificador Único Universal — código hexadecimal de 128 bits utilizado como llave única en la base de datos.",
    en: "Universally Unique Identifier",
    category: "tech",
  },
  URI: {
    es: "Identificador Uniforme de Recursos — ruta única que identifica un recurso (URL es una URI con protocolo).",
    en: "Uniform Resource Identifier",
    category: "tech",
  },
  API: {
    es: "Interfaz de Programación de Aplicaciones — conjunto de endpoints expuestos por el sistema.",
    en: "Application Programming Interface",
    category: "tech",
  },
  RLS: {
    es: "Seguridad a Nivel de Fila — control de acceso a datos por fila en la base de datos (Postgres).",
    en: "Row Level Security",
    category: "tech",
  },
  PWA: {
    es: "Aplicación Web Progresiva — sitio que funciona como app instalable en el dispositivo.",
    en: "Progressive Web App",
    category: "tech",
  },
  BPM: {
    es: "Gestión de Procesos de Negocio — bandeja de tareas centralizadas según rol.",
    en: "Business Process Management",
    category: "tech",
  },
  KPI: {
    es: "Indicador Clave de Desempeño — métrica operacional o financiera relevante.",
    en: "Key Performance Indicator",
    category: "tech",
  },
  NPS: {
    es: "Puntaje Neto de Promotor — encuesta de satisfacción de usuarios (-100 a +100).",
    en: "Net Promoter Score",
    category: "tech",
  },
  CSAT: {
    es: "Satisfacción del Cliente — medida directa de utilidad percibida.",
    en: "Customer Satisfaction",
    category: "tech",
  },
  SLO: {
    es: "Objetivo de Nivel de Servicio — meta interna de disponibilidad/latencia.",
    en: "Service Level Objective",
    category: "tech",
  },
  SLA: {
    es: "Acuerdo de Nivel de Servicio — compromiso de servicio con el cliente.",
    en: "Service Level Agreement",
    category: "tech",
  },
  WCAG: {
    es: "Pautas de Accesibilidad para el Contenido Web — estándar W3C de accesibilidad.",
    en: "Web Content Accessibility Guidelines",
    category: "tech",
  },

  // ───────────────────────────── Autenticación ───────────────────────────
  SSO: {
    es: "Inicio de Sesión Único — autenticación federada con un solo set de credenciales (ej. Microsoft 365).",
    en: "Single Sign-On",
    category: "auth",
  },
  MFA: {
    es: "Autenticación de Múltiples Factores — combina contraseña con un segundo factor (TOTP, SMS, etc.).",
    en: "Multi-Factor Authentication",
    category: "auth",
  },
  OTP: {
    es: "Contraseña de Un Solo Uso — código temporal generado por TOTP o SMS.",
    en: "One-Time Password",
    category: "auth",
  },
  TOTP: {
    es: "Contraseña Temporal Basada en Tiempo — código de 6 dígitos que cambia cada 30 segundos.",
    en: "Time-based One-Time Password",
    category: "auth",
  },
  PIN: {
    es: "Número de Identificación Personal — código corto para firmar electrónicamente.",
    en: "Personal Identification Number",
    category: "auth",
  },
  RBAC: {
    es: "Control de Acceso Basado en Roles — autorización según rol del usuario.",
    en: "Role-Based Access Control",
    category: "auth",
  },
  ABAC: {
    es: "Control de Acceso Basado en Atributos — autorización según atributos contextuales (servicio, paciente, tiempo, etc.).",
    en: "Attribute-Based Access Control",
    category: "auth",
  },
  OAuth: {
    es: "Protocolo abierto de autorización delegada — usado para login federado.",
    en: "Open Authorization",
    category: "auth",
  },
  OIDC: {
    es: "Capa de identidad sobre OAuth 2.0 — proporciona claims del usuario.",
    en: "OpenID Connect",
    category: "auth",
  },
  SMTP: {
    es: "Protocolo Simple de Transferencia de Correo — para envío de emails salientes.",
    en: "Simple Mail Transfer Protocol",
    category: "tech",
  },

  // ───────────────────────────── Clínico / NTEC ──────────────────────────
  NTEC: {
    es: "Norma Técnica del Expediente Clínico — marco regulatorio del MINSAL (Acuerdo n.° 1616, 2024).",
    category: "regulatory",
  },
  ECE: {
    es: "Expediente Clínico Electrónico — soporte digital del expediente NTEC.",
    category: "regulatory",
  },
  TDR: {
    es: "Términos de Referencia — documento de requerimientos funcionales del proyecto.",
    category: "regulatory",
  },
  DoD: {
    es: "Definición de Hecho — criterios mínimos para que una historia se considere completada.",
    en: "Definition of Done",
    category: "tech",
  },
  MINSAL: {
    es: "Ministerio de Salud de El Salvador — autoridad sanitaria nacional.",
    category: "regulatory",
  },
  ISSS: {
    es: "Instituto Salvadoreño del Seguro Social — administra cobertura de salud para trabajadores cotizantes.",
    category: "regulatory",
  },
  SRS: {
    es: "Sistema de Registro Sanitario — padrón nacional de medicamentos del MINSAL.",
    category: "regulatory",
  },
  WHO: {
    es: "Organización Mundial de la Salud (OMS).",
    en: "World Health Organization",
    category: "regulatory",
  },
  OMS: {
    es: "Organización Mundial de la Salud — agencia de la ONU para salud pública.",
    en: "World Health Organization (WHO)",
    category: "regulatory",
  },
  JCI: {
    es: "Joint Commission International — organismo internacional de acreditación hospitalaria.",
    category: "regulatory",
  },
  IPSG: {
    es: "Metas Internacionales de Seguridad del Paciente — estándares JCI (identificación, comunicación, alto riesgo, cirugía segura, infecciones, caídas).",
    en: "International Patient Safety Goals",
    category: "regulatory",
  },
  AHA: {
    es: "Asociación Americana del Corazón — emite protocolos cardiovasculares y de reanimación.",
    en: "American Heart Association",
    category: "regulatory",
  },
  NRP: {
    es: "Programa de Reanimación Neonatal — protocolo AHA para reanimación del recién nacido.",
    en: "Neonatal Resuscitation Program",
    category: "clinical",
  },

  // ───────────────────────────── Quirófano / Atención ────────────────────
  LOS: {
    es: "Duración de Estancia hospitalaria — días que el paciente permanece ingresado.",
    en: "Length of Stay",
    category: "clinical",
  },
  URPA: {
    es: "Unidad de Recuperación Post-Anestésica — sala de recuperación tras cirugía.",
    category: "clinical",
  },
  SOP: {
    es: "Sala de Operaciones — quirófano físico.",
    category: "clinical",
  },
  CPOE: {
    es: "Entrada de Órdenes Médicas Computarizada — prescripción electrónica con validación.",
    en: "Computerized Physician Order Entry",
    category: "clinical",
  },
  LIS: {
    es: "Sistema de Información de Laboratorio — gestiona órdenes y resultados de laboratorio clínico.",
    en: "Laboratory Information System",
    category: "clinical",
  },
  RIS: {
    es: "Sistema de Información de Radiología — gestiona órdenes y reportes de imágenes diagnósticas.",
    en: "Radiology Information System",
    category: "clinical",
  },
  MPI: {
    es: "Índice Maestro de Pacientes — registro único de identidad del paciente.",
    en: "Master Patient Index",
    category: "clinical",
  },
  eMAR: {
    es: "Registro Electrónico de Administración de Medicamentos — bitácora de cada dosis administrada.",
    en: "electronic Medication Administration Record",
    category: "clinical",
  },
  BCMA: {
    es: "Administración de Medicamentos por Código de Barras — verifica los 5 correctos vía escaneo GS1.",
    en: "Bar Code Medication Administration",
    category: "clinical",
  },
  RAM: {
    es: "Reacción Adversa a Medicamento — evento de farmacovigilancia.",
    category: "clinical",
  },
  RRI: {
    es: "Referencia, Retorno e Interconsulta — documento NTEC para coordinación entre servicios o centros.",
    category: "regulatory",
  },

  // ───────────────────────────── GS1 / Logística ─────────────────────────
  GS1: {
    es: "Estándar global de identificación de productos y trazabilidad (Global Standards 1).",
    category: "gs1",
  },
  GTIN: {
    es: "Número Global de Artículo Comercial — identifica unívocamente un producto comercial (14 dígitos).",
    en: "Global Trade Item Number",
    category: "gs1",
  },
  GSRN: {
    es: "Número Global de Relación de Servicio — identifica a personas (paciente, personal) en el ecosistema GS1 (18 dígitos).",
    en: "Global Service Relation Number",
    category: "gs1",
  },
  GLN: {
    es: "Número Global de Localización — identifica ubicaciones físicas (bodega, cama, sala).",
    en: "Global Location Number",
    category: "gs1",
  },
  FEFO: {
    es: "Primero en Vencer, Primero en Salir — regla de despacho de lotes por fecha de vencimiento.",
    en: "First Expired, First Out",
    category: "gs1",
  },
  EPCIS: {
    es: "Servicios de Información de Códigos Electrónicos — estándar GS1 para eventos de trazabilidad.",
    en: "Electronic Product Code Information Services",
    category: "gs1",
  },

  // ───────────────────────────── Roles / Personal ────────────────────────
  DIR: {
    es: "Director — autoridad clínica del establecimiento.",
    category: "clinical",
  },
  MC: {
    es: "Médico de Cabecera — médico tratante principal del paciente.",
    category: "clinical",
  },
  MT: {
    es: "Médico de Turno — médico de guardia que cubre fuera de horario del MC.",
    category: "clinical",
  },
  ENF: {
    es: "Personal de Enfermería.",
    category: "clinical",
  },
  RES: {
    es: "Médico Residente — médico en formación bajo supervisión.",
    category: "clinical",
  },
  ESP: {
    es: "Médico Especialista — atiende interconsultas según su especialidad.",
    category: "clinical",
  },
  QFB: {
    es: "Químico Farmacéutico — valida prescripción y dispensación.",
    category: "clinical",
  },
};

/**
 * Devuelve la definición canónica de una abreviatura, normalizando capitalización.
 * Devuelve `null` si el término no está registrado.
 */
export function lookupAbbreviation(term: string): AbbrDefinition | null {
  if (!term) return null;
  const direct = ABBREVIATIONS[term];
  if (direct) return direct;
  // Búsqueda case-insensitive (para terms tipo "eMAR" / "EMAR").
  const upper = term.toUpperCase();
  const match = Object.entries(ABBREVIATIONS).find(
    ([k]) => k.toUpperCase() === upper,
  );
  return match ? match[1] : null;
}

/** Lista todas las abreviaturas registradas (para docs/admin futuras). */
export function listAbbreviations(): Array<{ term: string; def: AbbrDefinition }> {
  return Object.entries(ABBREVIATIONS)
    .map(([term, def]) => ({ term, def }))
    .sort((a, b) => a.term.localeCompare(b.term));
}
