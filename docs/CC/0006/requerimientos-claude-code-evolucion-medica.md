# Requerimientos incrementales para Claude Code — Pantalla "Evolución Médica"
**Proyecto:** HIS Multipaís · Complejo Avante
**Alcance:** modificaciones a aplicar **a partir** del estado en que la pantalla ya tiene renombrado "Problema padre" → "Problema Sindrómico" y "Signos vitales" colocados arriba de "Objetivo" (ese cambio **NO** forma parte de este documento; es el punto de partida).
**Resultado esperado:** que la pantalla quede idéntica al **mockup final** `evolucion-medica-avante.html` (fuente de verdad visual e interactiva).
**Destino:** Claude Code

> Este documento registra, como requerimientos, las instrucciones acumuladas después del cambio mencionado. Aplíquelas en orden. Ante cualquier diferencia de estilo o detalle, **prevalece el mockup final** y el HIS Design System v2.0.

---

## Punto de partida (ya implementado, no incluido)
- "Problema padre" se llama **"Problema Sindrómico"** en todos los textos visibles.
- La sección **Signos vitales** aparece **arriba** de **Objetivo**.
- Orden de secciones vigente: Problemas → Subjetivo → **Signos vitales** → Objetivo → Evaluación/Análisis → Plan.

---

## R1 · Ampliar la sección Signos vitales (campos adicionales + cálculos + alertas)

Agregar a Signos vitales los siguientes campos, organizados en *fieldsets*. Salvo FiO₂ (ver R4), en este requerimiento todos entran como **opcionales** (la obligatoriedad del núcleo se define en R4).

### 1.1 Oxigenación y signos cardiorrespiratorios
- Añadir **FiO₂** (%) junto a SpO₂. Valor por defecto **21 %** (aire ambiente). Rango 21–100.

### 1.2 Estado neurológico y metabólico
- **Escala de Glasgow** mediante 3 selectores con descripción clínica y puntaje:
  - Apertura ocular (1–4): 4 Espontánea · 3 A la voz · 2 Al dolor · 1 Ninguna.
  - Respuesta verbal (1–5): 5 Orientada · 4 Confusa · 3 Palabras inapropiadas · 2 Sonidos incomprensibles · 1 Ninguna.
  - Respuesta motora (1–6): 6 Obedece órdenes · 5 Localiza el dolor · 4 Retira al dolor · 3 Flexión anormal · 2 Extensión anormal · 1 Ninguna.
  - **Total Glasgow** calculado (3–15) con severidad: **Leve 13–15 · Moderado 9–12 · Grave 3–8**.
- **Glucometría capilar** (mg/dL). Rango 10–900.

### 1.3 Antropometría
- **Peso en dos campos: kg y lb**, con **cálculo bidireccional** (al llenar uno se calcula el otro). Factor: `1 kg = 2.20462 lb`. Rango kg 0.5–400 / lb 1–880.
- **Talla en dos campos: m y ft**, con **cálculo bidireccional**. Factor: `1 m = 3.28084 ft`. Rango m 0.3–2.5 / ft 1–8.2.
- **IMC** calculado (solo lectura) = `peso(kg) / talla(m)²`, con clasificación a color: Bajo peso <18.5 · Normal 18.5–24.9 · Sobrepeso 25–29.9 · Obesidad ≥30.
- **Perímetro de cintura** (cm). Rango 30–250.

### 1.4 Balance hídrico
- **Balance hídrico** (mL, admite negativos).
- **Diuresis horaria** (mL/h). Rango 0–2000.

### 1.5 Gineco-obstétrico
- **Fecha de última regla (FUR)** (fecha).
- **Fecha probable de parto (FPP)** calculada (solo lectura) por **regla de Naegele**: a la FUR sumar 1 año, restar 3 meses y sumar 7 días. Mostrar además semanas de gestación.
- **Fórmula obstétrica G · P · P · A · V** en cinco campos numéricos: **G** Gestas · **P** Partos a término · **P** Partos pretérmino · **A** Abortos · **V** Vivos (esquema GTPAL).

### 1.6 Nuevas alertas críticas automáticas (en vivo)
Sumar a las alertas existentes:

| Condición | Alerta |
|---|---|
| Glucometría < 70 mg/dL | Hipoglucemia |
| Glucometría ≥ 250 mg/dL | Hiperglucemia |
| Glasgow total ≤ 8 (con las 3 respuestas) | Glasgow ≤8 |
| Diuresis < 0.5 mL/kg/h (usando el peso en kg) | Oliguria |

> Centralizar umbrales, factores de conversión y rangos en un módulo (p. ej. `lib/evolucion/signos-vitales.ts`) para poder tropicalizarlos sin tocar la UI.

---

## R2 · Condicionales por sexo/edad y sección colapsable

- **Gineco-obstétrico solo si el paciente es de sexo femenino.** Si es masculino, no se renderiza la sección.
- **FPP solo si la paciente "puede estar embarazada"** = sexo femenino **y** edad fértil. Definir el rango como **10–55 años** (parametrizable). Fuera de ese rango, la sección gineco-obstétrica conserva FUR y fórmula obstétrica, pero **se oculta el campo de FPP**.
- **Bloque colapsable**: desde **"Estado neurológico y metabólico" hasta "Dolor"** (incluye Glasgow, glucometría, antropometría, IMC, balance hídrico, gineco-obstétrico y EVA) debe poder **colapsarse/expandirse** con un control **"+ Ver más" / "− Ver menos"**. Inicia **plegado**. El núcleo (Presión arterial + Oxigenación y signos cardiorrespiratorios, incluida FiO₂) permanece **siempre visible**.

---

## R3 · Especialidad médica y datos del paciente desde el expediente

- **Antes de "Problemas"** debe existir un campo **"Especialidad médica"** con **autocompletado** (catálogo de especialidades) y **obligatorio**.
- El **sexo y la edad** del paciente deben colocarse **automáticamente desde el expediente** (no los digita el usuario). Estos valores alimentan las reglas condicionales de R2.

---

## R4 · Obligatoriedad de campos, firma y autoguardado

### 4.1 Núcleo de signos obligatorio
- **Todos** los campos de **Presión arterial** (TA sistólica, TA diastólica) y de **Oxigenación y signos cardiorrespiratorios** (FC, FR, Temperatura, SpO₂, **FiO₂**) son **obligatorios** (7 campos). El **resto de signos es opcional**.
- Al guardar el modal de Signos vitales: si falta alguno de los 7 o hay un valor fuera de rango, **resaltar** y **bloquear** el guardado con aviso.

### 4.2 Obligatorios para firmar
La acción **Firmar** se habilita solo cuando estén completos:
1. Especialidad médica.
2. Al menos **un problema**.
3. **Signos vitales** (los 7 del núcleo).
4. **Subjetivo**.
5. **Objetivo**.
6. **Evaluación/Análisis**.
7. Al menos **una indicación de plan**.

Mostrar una **pista dinámica** que indique qué falta (p. ej. "Falta: subjetivo, plan").

### 4.3 Firma
- **La firma es obligatoria** para completar la evolución: es el paso final, habilitado solo al cumplir 4.2.
- Al firmar, pedir **confirmación** y dejar la evolución **registrada de forma definitiva y no editable**.

### 4.4 Autoguardado
- **Autoguardar el borrador cada 30 segundos**, con indicación visual de guardado (marca de tiempo). Mantener además el guardado manual.
- (Producción: persistir a Supabase; no usar `localStorage`.)

---

## R5 · Autocompletado, corrección ortográfica y cuenta hospitalaria

### 5.1 Texto clínico
En los campos de texto clínico (**Problema, Problema sindrómico, Subjetivo, Objetivo, Evaluación/Análisis, Plan**):
- **Corrección ortográfica en español sugerida**: habilitar el corrector del navegador con `spellcheck="true"` y `lang="es"` (aprovecha el diccionario del navegador/SO; no empaquetar uno).
- **Autocompletado de términos médicos en cualquier idioma**: ofrecer sugerencias de términos médicos (español, latín, inglés) mientras se escribe, con coincidencia sin distinguir acentos, e insertar el término al elegirlo.
  - En el mockup se usa un glosario de demostración; **en producción conectar un vocabulario real (CIE-10 / SNOMED CT o catálogo institucional)**.
- El campo **Especialidad médica** queda con corrección ortográfica **desactivada** (es catálogo controlado).

### 5.2 Pacientes por cuenta hospitalaria
- **Habilitar únicamente los pacientes con cuenta hospitalaria activa asignados al usuario autenticado** (el médico que firma). El selector debe listar ese conjunto.
- Mostrar el estado **"Cuenta activa"** del paciente seleccionado y la indicación de que están **asignados al usuario**.

### 5.3 Etiqueta del selector
- **Reemplazar la etiqueta "Demo"** del selector de paciente por la etiqueta **"Cuenta Hospitalaria"**.

---

## Criterios de aceptación (checklist)

- [ ] Signos vitales incluye FiO₂, Glasgow (con total y severidad), glucometría, peso (kg↔lb), talla (m↔ft), IMC con clasificación, perímetro de cintura, balance hídrico, diuresis horaria, FUR, FPP (Naegele) y fórmula obstétrica G·P·P·A·V.
- [ ] Cálculos bidireccionales (peso, talla) e IMC, total de Glasgow y FPP funcionan en vivo.
- [ ] Alertas nuevas: Hipoglucemia, Hiperglucemia, Glasgow ≤8, Oliguria.
- [ ] Gineco-obstétrico solo si femenino; FPP solo si femenino en edad fértil (10–55).
- [ ] Bloque "Estado neurológico…→Dolor" colapsable (Ver más/Ver menos), iniciando plegado; núcleo siempre visible.
- [ ] Campo "Especialidad médica" antes de Problemas: autocompletado + obligatorio.
- [ ] Sexo y edad provienen del expediente (no editables por el usuario).
- [ ] Núcleo de signos (7 campos) obligatorio; resto opcional; guardado bloqueado si faltan/fuera de rango.
- [ ] Firmar exige especialidad + problema + signos núcleo + subjetivo + objetivo + análisis + plan; pista de pendientes visible.
- [ ] Firma con confirmación e inmutabilidad posterior.
- [ ] Autoguardado cada 30 s.
- [ ] Corrección ortográfica en español + autocompletado de términos médicos en los campos clínicos; especialidad sin corrector.
- [ ] Selector limitado a pacientes con cuenta hospitalaria activa asignados al usuario.
- [ ] Etiqueta del selector dice "Cuenta Hospitalaria" (no "Demo").
- [ ] El resultado coincide con `evolucion-medica-avante.html`.

---

## Prompt de arranque para Claude Code

```
Aplica los requerimientos R1–R5 del documento requerimientos-claude-code-evolucion-medica.md
sobre la pantalla "Evolución Médica", partiendo del estado en que "Problema Sindrómico" ya está
renombrado y "Signos vitales" ya está arriba de "Objetivo".

Usa evolucion-medica-avante.html como fuente de verdad visual e interactiva y respeta el
HIS Design System v2.0 y las convenciones del repo.

Reglas clave:
- Centraliza umbrales, factores de conversión y rangos de signos vitales en lib/evolucion/signos-vitales.ts (R1).
- Gineco-obstétrico solo si femenino; FPP solo si femenino en edad fértil 10–55 (R2).
- Bloque neurológico→dolor colapsable, iniciando plegado; núcleo siempre visible (R2).
- "Especialidad médica" antes de Problemas: autocompletado + obligatorio; sexo/edad desde el expediente (R3).
- Núcleo de signos (TA sist, TA diast, FC, FR, Temp, SpO₂, FiO₂) obligatorio; resto opcional (R4).
- Firmar exige especialidad, problema, signos núcleo, subjetivo, objetivo, análisis y plan; firma definitiva; autoguardado cada 30 s (R4).
- Corrección ortográfica es (spellcheck/lang) + autocompletado de términos médicos (glosario → CIE-10/SNOMED) en campos clínicos (R5).
- Selector limitado a pacientes con cuenta hospitalaria activa asignados al usuario; etiqueta "Cuenta Hospitalaria" (R5).

Antes de programar, propón el árbol de archivos y los tipos afectados, y espera mi confirmación.
Al final, verifica contra los criterios de aceptación del documento.
```
