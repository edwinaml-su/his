/**
 * JCI "Do Not Use" list — abreviaciones prohibidas en texto clínico.
 *
 * Fuente normativa: JCI Accreditation Standards (8th ed.) IPSG.2 ME 3;
 * The Joint Commission National Patient Safety Goals (NPSG.02.02.01).
 *
 * Política HIS: warning-only. No bloquea la firma. El médico decide.
 * Enforcement mode será definido por CMO en futura iteración.
 */

export interface AbbreviationWarning {
  /** Abreviación encontrada en el texto original */
  match: string;
  /** Posición (índice de carácter) en el texto */
  offset: number;
  /** Sustitución recomendada */
  replacement: string;
  /** Razón clínica del riesgo */
  rationale: string;
  severity: "error" | "warning";
}

export interface ForbiddenAbbreviationRule {
  pattern: RegExp;
  replacement: string;
  severity: "error" | "warning";
  rationale: string;
}

/**
 * Lista canónica JCI "Do Not Use".
 * Cada pattern usa flag `gi` para ser case-insensitive y global.
 * Los flags se añaden en validateClinicalText al ejecutar el match.
 */
export const FORBIDDEN_ABBREVIATIONS: ReadonlyArray<ForbiddenAbbreviationRule> = [
  // 1. U — unidad (confundido con 0, 4 o cc)
  {
    pattern: /\b(\d+)\s*U\b(?!\w)/,
    replacement: "usar 'unidades' (ej. '10 unidades')",
    severity: "error",
    rationale: "JCI NPSG: 'U' confundido con 0 o 4, causando errores de dosis 10× o 4×.",
  },
  // 2. IU — unidad internacional
  {
    pattern: /\bIU\b/,
    replacement: "usar 'unidades internacionales'",
    severity: "error",
    rationale: "JCI NPSG: 'IU' interpretada como IV (intravenoso) o 10, causando sobredosis.",
  },
  // 3. QD / Q.D. / qd — cada día
  {
    pattern: /\bQ\.?D\.?\b/,
    replacement: "escribir 'diariamente' o 'cada 24 horas'",
    severity: "error",
    rationale: "JCI NPSG: 'QD' confundido con 'QID' (4 veces/día), error 4×.",
  },
  // 4. QOD / Q.O.D. — día por medio
  {
    pattern: /\bQ\.?O\.?D\.?\b/,
    replacement: "escribir 'cada dos días' o 'día por medio'",
    severity: "error",
    rationale: "JCI NPSG: 'QOD' confundido con 'QD' (diario) o 'QID'.",
  },
  // 5. Trailing zero — 1.0 mg (confundido con 10 mg)
  {
    pattern: /\b(\d+)\.0\s*(mg|mcg|mL|g|kg|mEq|mmol)\b/,
    replacement: "omitir el decimal innecesario (ej. '1 mg' en lugar de '1.0 mg')",
    severity: "error",
    rationale: "JCI NPSG: '1.0 mg' confundido con '10 mg', dosis 10× mayor.",
  },
  // 6. Leading zero ausente — .5 mg en lugar de 0.5 mg
  {
    pattern: /(?<!\d)\.([\d]+)\s*(mg|mcg|mL|g|kg|mEq|mmol)\b/,
    replacement: "agregar cero inicial (ej. '0.5 mg')",
    severity: "error",
    rationale: "JCI NPSG: '.5 mg' puede leerse como '5 mg', dosis 10× mayor.",
  },
  // 7. MS — morfina vs sulfato de magnesio
  {
    pattern: /\bMS\b(?!\s*Office|\s*SQL|\s*Teams)/,
    replacement: "escribir 'morfina' o 'sulfato de magnesio' explícitamente",
    severity: "error",
    rationale: "JCI NPSG: 'MS' ambigua entre morfina (morfine sulfate) y MgSO4.",
  },
  // 8. MSO4 — morfina sulfato
  {
    pattern: /\bMSO4\b/,
    replacement: "escribir 'morfina' o 'sulfato de morfina'",
    severity: "error",
    rationale: "JCI NPSG: 'MSO4' confundido con 'MgSO4' (sulfato de magnesio).",
  },
  // 9. MgSO4 — sulfato de magnesio (confundido con morfina)
  {
    pattern: /\bMgSO4\b/,
    replacement: "escribir 'sulfato de magnesio'",
    severity: "error",
    rationale: "JCI NPSG: 'MgSO4' confundido con 'MSO4' (morfina sulfato).",
  },
  // 10. μg — microgramos (símbolo Unicode confundido con mg)
  // \b no funciona con Unicode; usamos lookbehind/lookahead de espacio o inicio/fin
  {
    pattern: /(?<![a-zA-Z])μg(?![a-zA-Z])/,
    replacement: "usar 'mcg'",
    severity: "error",
    rationale: "JCI NPSG: símbolo 'μg' confundido con 'mg' en escritura manual/tipografía pobre.",
  },
  // 11. cc — centímetros cúbicos
  {
    pattern: /\b(\d+(?:\.\d+)?)\s*cc\b/,
    replacement: "usar 'mL' (mililitros)",
    severity: "warning",
    rationale: "JCI NPSG: 'cc' confundido con '00' (ceros), causando errores de volumen.",
  },
  // 12. HS / h.s. — hora de dormir (hora somni)
  {
    pattern: /\bh\.?s\.?\b/,
    replacement: "escribir 'al acostarse' o 'hora de dormir'",
    severity: "warning",
    rationale: "JCI NPSG: 'hs' confundido con 'hora' (cada hora), frecuencia 8× mayor.",
  },
  // 13. SC / SQ — subcutáneo (confundido con SL sublingual)
  {
    pattern: /\bS\.?[CQ]\.?\b(?!\s*[A-Z]{2,})/,
    replacement: "escribir 'subcutáneo'",
    severity: "warning",
    rationale: "JCI: 'SQ' confundido con 'SL' (sublingual), vía de administración incorrecta.",
  },
  // 14. D/C — discontinuar (confundido con alta/discharge)
  {
    pattern: /\bD\/?C\b/,
    replacement: "escribir 'discontinuar' o 'suspender' (no 'D/C')",
    severity: "warning",
    rationale: "JCI NPSG: 'D/C' ambigua entre 'discontinuar' y 'dar de alta' (discharge).",
  },
  // 15. TIW — tres veces por semana
  {
    pattern: /\bTIW\b/,
    replacement: "escribir 'tres veces por semana'",
    severity: "warning",
    rationale: "JCI: 'TIW' confundido con 'BIW' (2×/semana) o 'TID' (3×/día).",
  },
] as const;

// ---------------------------------------------------------------------------
// Validador puro
// ---------------------------------------------------------------------------

/**
 * Escanea `text` buscando cada patrón de FORBIDDEN_ABBREVIATIONS.
 * Retorna warnings y errors separados; no lanza excepciones.
 * Función pura: sin side-effects, sin I/O.
 *
 * @param text — Texto clínico libre (anamnesis, examen físico, notas, etc.)
 */
export function validateClinicalText(text: string): {
  warnings: AbbreviationWarning[];
  errors: AbbreviationWarning[];
} {
  if (!text || text.trim().length === 0) {
    return { warnings: [], errors: [] };
  }

  const warnings: AbbreviationWarning[] = [];
  const errors: AbbreviationWarning[] = [];

  for (const rule of FORBIDDEN_ABBREVIATIONS) {
    // Reconstruir con flags gi para búsqueda global e insensible a mayúsculas.
    // No mutamos el patrón original (readonly).
    const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "gi";
    const globalPattern = new RegExp(rule.pattern.source, flags);

    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      const finding: AbbreviationWarning = {
        match: match[0],
        offset: match.index,
        replacement: rule.replacement,
        rationale: rule.rationale,
        severity: rule.severity,
      };

      if (rule.severity === "error") {
        errors.push(finding);
      } else {
        warnings.push(finding);
      }

      // Avanzar para evitar bucle infinito con zero-length matches
      if (match[0].length === 0) {
        globalPattern.lastIndex++;
      }
    }
  }

  return { warnings, errors };
}
