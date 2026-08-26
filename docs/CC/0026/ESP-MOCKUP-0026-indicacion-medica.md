# ESP-MOCKUP CC-0026 — Indicación médica y medicación (extracción funcional)

Fuente: `avanteindicacionmedicamockup (1).html` (2.6 MB; ~97% = catálogo
`MED_DATA` embebido + calculadora B64 **excluida por directiva**). Este doc
destila las REGLAS FUNCIONALES; los valores visuales (colores, espaciados,
tipografía) se leen del mockup directamente (§Fidelidad de diseño CLAUDE.md).
Sticky header y calculadoras: EXCLUIDOS (ya integrados al HIS).

## Estructura general

- Barra de tipo de indicación (`indBar`): `Inicial` (solo hasta la primera
  firma) → `Subsecuente` con subtipos `Indicación diaria | Indicación rápida`.
- **REGLA DE BACKEND (texto literal del mockup):** "el tipo de indicación y el
  plazo máximo de 32 h entre indicaciones deben implementarse y validarse en
  el servidor (guardar en BD el timestamp de la última indicación firmada y
  rechazar la mutación que incumpla la regla o el tipo que no corresponda).
  La interfaz solo informa y guía". Chip countdown con warn < 6 h.
- Grid de 8 categorías (`CATS`); cada una abre modal de captura y agrega
  líneas a un cuadro read-only por categoría (máx. 3 líneas visibles,
  `MAX_LINES=3`; categorías `freeBox` — mov y cuidados — cuadro único sin
  límite de líneas).
- `Firmar indicación` congela el set completo como bloque en el tablero
  general (`firmadas[]`) con título INDICACIÓN INICIAL / {SUBTIPO} ·
  SUBSECUENTE + fecha + rol firmante, vacía los cuadros y suma los cargos
  de medicamentos a la cuenta (`cuentaFija`).

## Categorías

| key | Label | Color | Reglas clave |
|---|---|---|---|
| mov | Movimiento de paciente | #0d9488 | Primera orden. Sede desde admisión (HE Masferrer / CM Beethoven / SAT Surf City). Tipos por sede: HE/CM={Ingreso a, Pase a, Traslado a, Referencia a, Remisión a}, SAT={Pase, Referencia, Remisión}. Ingreso→servicio clínico (HE: Hosp adultos/pediátrica/UCI/UCINT/UCE/UICA; CM: Hosp adultos). Pase→unidad/sala por sede (HE incl. Unidad de Máxima Urgencia). Traslado HE→cascada piso→servicio→habitación (catálogo real de habitaciones por nombre); CM→lista fija 24 habitaciones. Remisión→{ISSS, Red Nacional de Hospitales, ISBM}. |
| dieta | Dieta | #ca8a04 | Tipo (10 opc. incl. NPO/enteral SNG/parenteral) + vía + consistencia/frecuencia + restricciones + obs. |
| cuidados | Cuidados de enfermería | #7c3aed | 20 subsecciones (abajo). Abierta=se registra; contraída=no; TODAS deben resolverse (abierta o "No aplica") o el agregar se bloquea marcando pendientes en rojo. El set completo = UNA indicación. |
| med | Medicamentos | #2563eb | Búsqueda 3+ letras sobre catálogo real del repo (`catalogo_import.csv`, 14,179 ítems, banderas de seguridad, **vía restringida al registro SRS**). Dosis+unidad (mg,g,mcg,UI,mEq,ml,tableta,cápsula,gota,puff,ampolla) + frecuencia {STAT, Dosis única, c/4h…c/24h, Infusión continua, PRN} + duración + cantidad a cargar → P.U.×cant=total al rubro de cuenta. P.U. real = pricelist Odoo. |
| lab | Exámenes de laboratorio | #0891b2 | Búsqueda catálogo lab 2+ letras + prioridad {Rutina,Urgente,STAT} + tipo de muestra + obs. **HIS: llama al módulo LIS preexistente (CC-0013).** |
| gab | Exámenes de gabinete | #4f46e5 | Estudio + modalidad {Rx,USG,TAC,RM,ECG,Endoscopía,Otro} + región + prioridad + justificación. **HIS: llama al módulo imágenes preexistente (CC-0016).** |
| proc | Procedimientos | #db2777 | Procedimiento + prioridad {Programado,Urgente,STAT} + requiere consentimiento S/N + obs. |
| inter | Interconsultas | #ea580c | Especialidad (11 opc.) + prioridad + motivo. |

## CUI_SECTIONS (cuidados) — 20 subsecciones

1. Mantener aislamiento — tipo {contacto, gotas, aerosol, invertido} · NA
2. **Tomar signos vitales** (kind sv — HIS: invoca capturador CC-0012)
3. Balance hídrico y diuresis horaria — {4,6,8,12 h, Día} · NA
4. Tomar temperatura — {1,2,4,6,8,12 h, Día} · NA
5. Movilidad (Mantener) · 6. Respaldo (Mantener)
7. Cambio de posición c/2h · NA · 8. Colchón antiescaras · NA
9. Cuidado de piel y mucosas · 10. Aseo oral
11. Baño diario en {cama, ducha}
12. Cuidado de sonda — multi {NSG, nasoyeyunal, gastrostomía, ileostomía, transuretral} · NA
13. Cuidado de catéter — multi {venoclisis perif., CVC central, PICC, PORT-A-CATH, PERM-A-CATH, Mahurkar, Tenckhoff} · NA
14. Cuidado de tubo — multi {orotraqueal, tórax} · NA
15. Glucometría capilar — + checkbox "y cumplir insulina subcutánea según esquema" · NA
16. Mantener O₂ a aire ambiente
17. **O₂ suplementario** · NA — dispositivo {cánula bajo flujo, Venturi, reservorio, CNAF}; Venturi con tabla color↔FiO₂↔flujo: Azul 24% 2-4(3) · Blanco 28% 4-6(5) · Naranja 31% 6-8(7) · Amarillo 35% 8-10(9) · Rojo 40% 10-12(11) · Verde 60% 15(15)
18. **VMNI** · NA — CPAP {Neo 4-8, Ped 4-10, Adulto 4-20} · IPAP {Ped 8-20, Ad 8-30} · EPAP {Ped 4-10, Ad 4-20} · FR {Ped 10-40, Ad 8-30} · Ti {Ped 0.5-1.2, Ad 0.5-2.0}
19. (16-19 forman el bloque respiratorio; abrir uno excluye los otros — `secBlocked`)
20. **VMI** · NA — modos por grupo etario: Neo {PC-CMV,VC-CMV,SIMV-PC,SIMV-VC,PSV,CPAP}, Ped {VCV,PCV,SIMV-VC,SIMV-PC,PSV,CPAP}, Adulto ídem + params

## Mapeo HIS (decisiones D1/D2 del REQ)

- mov → `EncounterTransfer`/orden-ingreso/RRI según tipo (Ola 2 conecta solo
  la captura; la unificación de los 3 bounded contexts queda documentada como
  límite).
- med → catálogo `Drug` (drugId estructurado — cierra parcialmente R06).
- lab → `LabOrder` (LIS) + CareTask área LAB. gab → `ImagingRequest` + CareTask RX.
- Toda categoría → CareTask NURSE en la unidad del episodio.
- Firma → `firmar()` del router legacy `indicaciones-medicas` (extender, NO duplicar).
