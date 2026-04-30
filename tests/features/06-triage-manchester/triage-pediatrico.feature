# language: es
# Épica: E6 — Triage Manchester
# Historias cubiertas: US-6.9
# TDR: §9
# Persona principal: P4 — Triador pediátrico
# Valor de negocio: Triage seguro en pediatría con TEP, FLACC y Wong-Baker
# adecuados a la edad del paciente.

@critical @triage @pediatric @es-SV
Característica: Triage Manchester pediátrico
  Como triador (P4)
  Quiero clasificar pacientes pediátricos con escalas adecuadas a su edad
  Para asegurar diagnósticos rápidos y certeros en niños.

  Antecedentes:
    Dado los flujogramas pediátricos Manchester están vigentes
    Y las escalas configuradas son:
      | escala       | rango_edad                  | uso              |
      | TEP          | 0-18 años                   | impresión inicial|
      | FLACC        | 2 meses - 7 años            | dolor            |
      | Wong-Baker   | 3 - 18 años                 | dolor            |
    Y inicio sesión con rol "triador"
    Y selecciono contexto "Emergencia Pediátrica"

  @smoke @tep
  Escenario: Aplicación de Triángulo de Evaluación Pediátrica (TEP)
    Dado un paciente de 4 años con flujograma "Niño que llora inconsolablemente"
    Cuando aplico TEP con resultado:
      | componente             | hallazgo  |
      | apariencia             | alterada  |
      | trabajo_respiratorio   | aumentado |
      | circulacion_piel       | normal    |
    Entonces el sistema clasifica como "fallo respiratorio compensado"
    Y sugiere nivel "Naranja"
    Y publica "TEPApplied"

  @flacc
  Escenario: Evaluación de dolor con FLACC en lactante
    Dado un paciente de 18 meses con sospecha de dolor
    Cuando aplico FLACC con puntaje total "7"
    Entonces el sistema clasifica dolor como "severo"
    Y influye en discriminadores Manchester

  @wong-baker
  Escenario: Evaluación de dolor con Wong-Baker en niño escolar
    Dado un paciente de 8 años con dolor abdominal
    Cuando aplico Wong-Baker con resultado "6 (mucho dolor)"
    Entonces el sistema sugiere nivel "Naranja" o "Amarillo" según otros discriminadores

  @vitals @ranges
  Esquema del escenario: Rangos de signos vitales por edad pediátrica
    Cuando capturo signos vitales en paciente de "<edad>" años
    Entonces el sistema valida rangos según "<edad>"
    Y rechaza valores fuera de rango con sugerencia

    Ejemplos:
      | edad |
      | 0    |
      | 1    |
      | 5    |
      | 10   |
      | 15   |

  @bypass
  Escenario: Paciente pediátrico crítico salta a Rojo
    Dado un paciente de 2 años con TEP "fallo cardiopulmonar"
    Cuando aplico el triage
    Entonces el sistema asigna nivel "Rojo" sin requerir más discriminadores
    Y activa "Código Azul Pediátrico"
