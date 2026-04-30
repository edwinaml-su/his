# language: es
# Épica: E7 — Localización SV
# Historias cubiertas: US-7.2
# TDR: §27
# Persona principal: P3 — Admisión, P8 — Admin (cuentas hospitalarias)
# Valor de negocio: NIT válido para facturación y trazabilidad fiscal SV.

@regression @localization @sv @nit
Característica: Validación de NIT (SV)
  Como admisión / administración
  Quiero validar el NIT con su algoritmo oficial
  Para evitar facturación errónea y datos fiscales incorrectos.

  Antecedentes:
    Dado el algoritmo oficial de NIT SV: 14 dígitos con dígito verificador

  @validation
  Esquema del escenario: Matriz de NIT
    Cuando valido el NIT "<nit>"
    Entonces el resultado es "<resultado>"
    Y el motivo es "<motivo>"

    Ejemplos: Casos válidos
      | nit              | resultado | motivo |
      | 0614-150385-101-2| valido    | OK     |
      | 0210-280790-001-8| valido    | OK     |

    Ejemplos: Casos inválidos
      | nit               | resultado | motivo                          |
      |                   | invalido  | nit_obligatorio_persona_juridica|
      | 0614150385101-2   | invalido  | formato_invalido                |
      | 0614-150385-101-9 | invalido  | digito_verificador_no_coincide  |
      | ABCD-150385-101-2 | invalido  | caracteres_no_numericos         |
      | 0614-150385-101   | invalido  | longitud_invalida               |

  @rule
  Escenario: NIT requerido para personas jurídicas, opcional para naturales
    Dado un paciente persona natural con DUI
    Entonces NIT es opcional
    Dado un cliente facturable persona jurídica
    Entonces NIT es obligatorio para emitir cuenta hospitalaria

  # TODO refinar con super-usuario fiscal:
  # diferenciación entre NIT antiguo y nuevo formato; integración futura con DGII.
