# language: es
# Épica: E7 — Localización SV / E4 — MPI
# Historias cubiertas: US-4.2, US-7.2
# TDR: §27
# Persona principal: P3 — Admisión
# Valor de negocio: Validación oficial del DUI evita errores de identificación
# y reduce duplicados en SV.

@critical @localization @sv @dui
Característica: Validación de DUI con dígito verificador (módulo 10)
  Como admisión
  Quiero que el sistema valide el formato y dígito verificador del DUI
  Para garantizar identidad correcta y prevenir duplicados.

  Antecedentes:
    Dado el algoritmo oficial de DUI: 8 dígitos + guion + 1 dígito verificador

  @validation
  Esquema del escenario: Matriz exhaustiva de DUI
    Cuando valido el DUI "<dui>"
    Entonces el resultado es "<resultado>"
    Y el motivo es "<motivo>"

    # Válidos
    Ejemplos: Casos válidos
      | dui          | resultado | motivo            |
      | 04567823-4   | valido    | OK                |
      | 00000001-9   | valido    | OK                |
      | 12345678-5   | valido    | OK                |
      | 03219876-8   | valido    | OK                |
      | 06789012-3   | valido    | OK                |

    # Inválidos por dígito verificador
    Ejemplos: Dígito verificador incorrecto
      | dui          | resultado | motivo                            |
      | 04567823-0   | invalido  | digito_verificador_no_coincide    |
      | 12345678-9   | invalido  | digito_verificador_no_coincide    |

    # Inválidos por formato
    Ejemplos: Formato incorrecto
      | dui          | resultado | motivo                                |
      |              | invalido  | dui_obligatorio                       |
      | 4567823-4    | invalido  | longitud_invalida                     |
      | 045678234    | invalido  | falta_guion                           |
      | ABCDEFGH-1   | invalido  | caracteres_no_numericos               |
      | 04567823-A   | invalido  | digito_verificador_no_numerico        |
      | 04-567823-4  | invalido  | guion_en_posicion_incorrecta          |
      | 00000000-0   | invalido  | dui_no_permitido_todos_ceros          |

  @library
  Escenario: Reuso del validador como librería compartida
    Dado el paquete "@his/localization-sv" expone "validateDUI"
    Cuando cualquier módulo importa la función
    Entonces obtiene el mismo comportamiento determinista
    Y existen tests unitarios en el paquete con cobertura >= 95%
