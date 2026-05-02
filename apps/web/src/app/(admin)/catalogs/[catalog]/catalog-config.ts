/**
 * US-3.2 — Metadata UI por catálogo.
 *
 * Mapea slug-de-URL → modelo Prisma (key) + descripción es-SV + lista de campos
 * para que `<CatalogTable>` y `<CatalogForm>` sean genéricos.
 *
 * Reglas:
 *  - El slug es kebab-case (URL-friendly), `model` es la key tRPC (camelCase, debe
 *    coincidir con catalogRouter.modelMap).
 *  - `fields` describe SOLO los campos editables en UI. id/createdAt/updatedAt/version
 *    son responsabilidad del servidor.
 *  - `codeField` es el campo que la tabla usa como columna "Código" (algunos catálogos
 *    no tienen `code`: Language usa `isoCode`, Occupation usa `ciuoCode`).
 *
 * TODO(Sprint 2): añadir help-text por campo + tooltips.
 * TODO(Sprint 2): selector de Country para IdentifierType y Ethnicity (hoy = input UUID).
 * TODO(Sprint 2): selector de parentId para MedicalSpecialty con árbol.
 */
import type { CatalogKey } from "@his/contracts";

export type CatalogFieldType = "text" | "number" | "boolean" | "uuid";

export interface CatalogField {
  name: string;
  label: string;
  type: CatalogFieldType;
  required: boolean;
  placeholder?: string;
  hint?: string;
}

export interface CatalogConfig {
  /** Key tRPC (camelCase). */
  model: CatalogKey;
  /** Título mostrado en el header. */
  label: string;
  /** Singular para el dialog. */
  singular: string;
  /** Descripción corta es-SV (subtítulo). */
  description: string;
  /** Nombre del campo "código" en este modelo (para tabla y unicidad). */
  codeField: "code" | "isoCode" | "ciuoCode";
  fields: CatalogField[];
}

const ACTIVE_FIELD: CatalogField = {
  name: "active",
  label: "Activo",
  type: "boolean",
  required: false,
  hint: "Desmarcar para soft-delete (deshabilitar sin borrar).",
};

export const CATALOGS = {
  "identifier-type": {
    model: "identifierType",
    label: "Tipos de Documento de Identidad",
    singular: "Tipo de documento",
    description: "DUI, NIT, NIE, pasaporte… específicos por país (TDR §7.1).",
    codeField: "code",
    fields: [
      {
        name: "countryId",
        label: "País (UUID)",
        type: "uuid",
        required: true,
        hint: "TODO(Sprint 2): combo de países en lugar de UUID manual.",
      },
      { name: "code", label: "Código", type: "text", required: true, placeholder: "DUI" },
      { name: "name", label: "Nombre", type: "text", required: true, placeholder: "Documento Único de Identidad" },
      {
        name: "validatorFn",
        label: "Función validadora SQL (opcional)",
        type: "text",
        required: false,
        placeholder: "validate_dui",
      },
      ACTIVE_FIELD,
    ],
  },
  gender: {
    model: "gender",
    label: "Géneros",
    singular: "Género",
    description: "Identidad de género (catálogo separado del sexo biológico).",
    codeField: "code",
    fields: [
      { name: "code", label: "Código", type: "text", required: true, placeholder: "M / F / NB" },
      { name: "name", label: "Nombre", type: "text", required: true },
      ACTIVE_FIELD,
    ],
  },
  "biological-sex": {
    model: "biologicalSex",
    label: "Sexos Biológicos",
    singular: "Sexo biológico",
    description: "Sexo asignado al nacer: M, F, I (intersex), U (desconocido).",
    codeField: "code",
    fields: [
      { name: "code", label: "Código", type: "text", required: true, placeholder: "M" },
      { name: "name", label: "Nombre", type: "text", required: true },
      ACTIVE_FIELD,
    ],
  },
  "marital-status": {
    model: "maritalStatus",
    label: "Estados Civiles",
    singular: "Estado civil",
    description: "Soltero, casado, viudo, etc.",
    codeField: "code",
    fields: [
      { name: "code", label: "Código", type: "text", required: true, placeholder: "SOL" },
      { name: "name", label: "Nombre", type: "text", required: true, placeholder: "Soltero/a" },
      ACTIVE_FIELD,
    ],
  },
  "education-level": {
    model: "educationLevel",
    label: "Niveles Educativos",
    singular: "Nivel educativo",
    description: "Niveles de escolaridad ordenados (TDR §7.2).",
    codeField: "code",
    fields: [
      { name: "code", label: "Código", type: "text", required: true, placeholder: "BACH" },
      { name: "name", label: "Nombre", type: "text", required: true, placeholder: "Bachillerato" },
      {
        name: "ordinal",
        label: "Orden",
        type: "number",
        required: true,
        hint: "Orden creciente (0 = ninguno, 5 = doctorado).",
      },
      ACTIVE_FIELD,
    ],
  },
  religion: {
    model: "religion",
    label: "Religiones",
    singular: "Religión",
    description: "Religión / culto declarado.",
    codeField: "code",
    fields: [
      { name: "code", label: "Código", type: "text", required: true, placeholder: "CAT" },
      { name: "name", label: "Nombre", type: "text", required: true, placeholder: "Católica" },
      ACTIVE_FIELD,
    ],
  },
  language: {
    model: "language",
    label: "Idiomas",
    singular: "Idioma",
    description: "Idiomas en código ISO 639-3.",
    codeField: "isoCode",
    fields: [
      { name: "isoCode", label: "Código ISO 639-3", type: "text", required: true, placeholder: "spa" },
      { name: "name", label: "Nombre", type: "text", required: true, placeholder: "Español" },
      ACTIVE_FIELD,
    ],
  },
  ethnicity: {
    model: "ethnicity",
    label: "Etnias",
    singular: "Etnia",
    description: "Etnia auto-declarada por el paciente. Puede ser global (sin país) o por país.",
    codeField: "code",
    fields: [
      {
        name: "countryId",
        label: "País (UUID, opcional)",
        type: "uuid",
        required: false,
        hint: "Vacío = catálogo global.",
      },
      { name: "code", label: "Código", type: "text", required: true, placeholder: "MAYA" },
      { name: "name", label: "Nombre", type: "text", required: true, placeholder: "Maya" },
      ACTIVE_FIELD,
    ],
  },
  "patient-type": {
    model: "patientType",
    label: "Tipos de Paciente",
    singular: "Tipo de paciente",
    description: "Ambulatorio, hospitalizado, emergencia… (TDR §7.3.1).",
    codeField: "code",
    fields: [
      { name: "code", label: "Código", type: "text", required: true, placeholder: "AMB" },
      { name: "name", label: "Nombre", type: "text", required: true, placeholder: "Ambulatorio" },
      ACTIVE_FIELD,
    ],
  },
  "patient-category": {
    model: "patientCategory",
    label: "Categorías de Paciente",
    singular: "Categoría de paciente",
    description: "Privado, ISSS, MINSAL, FOSALUD… (TDR §7.3.1).",
    codeField: "code",
    fields: [
      { name: "code", label: "Código", type: "text", required: true, placeholder: "PRIV" },
      { name: "name", label: "Nombre", type: "text", required: true, placeholder: "Privado" },
      ACTIVE_FIELD,
    ],
  },
} as const satisfies Record<string, CatalogConfig>;

export type CatalogSlug = keyof typeof CATALOGS;

export function getCatalogConfig(slug: string): CatalogConfig | undefined {
  return (CATALOGS as Record<string, CatalogConfig>)[slug];
}

export const CATALOG_SLUGS = Object.keys(CATALOGS) as CatalogSlug[];
