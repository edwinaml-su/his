# language: es
# Épica: E1 — Multi-Entidad
# Historias cubiertas: US-1.1 (parcial), US-1.3, US-1.6
# TDR: §5 (Multi-país, multi-moneda)
# Persona principal: P8 — Super-admin TI; P6 — Jefe servicio (visualización)
# Valor de negocio: Operar en USD (SV) y otras monedas regionales, con tasas de cambio
# trazables y moneda funcional vs. presentación clara por organización.

@regression @multi-entidad @currency @es-SV
Característica: Moneda funcional, presentación y tasas de cambio
  Como super-admin (P8)
  Quiero configurar moneda funcional por organización y mantener tasas de cambio versionadas
  Para que los datos financieros sean coherentes y auditables.

  Antecedentes:
    Dado que existe el país "SV" con moneda oficial "USD"
    Y existe la organización "Avante Salud SA de CV" en "SV"
    Y inicio sesión como "super_admin"

  @smoke
  Escenario: Moneda funcional por defecto en organización SV
    Cuando consulto la configuración de "Avante Salud SA de CV"
    Entonces la moneda funcional por defecto es "USD"
    Y la moneda de presentación por defecto es "USD"

  @config
  Escenario: Configurar moneda de presentación distinta a la funcional
    Cuando configuro la moneda de presentación como "EUR" para reportes gerenciales
    Entonces los reportes muestran montos convertidos a "EUR" usando la tasa "promedio" del periodo
    Y la moneda funcional sigue siendo "USD" para registros transaccionales
    Y queda auditado el cambio "FunctionalCurrencyConfigChanged"

  @rate-types
  Esquema del escenario: Tipos de tasa de cambio soportados
    Cuando registro una tasa "<tipo>" para "<base>" → "<destino>" valor "<valor>" fecha "<fecha>"
    Entonces la tasa queda activa para conversiones de tipo "<tipo>"
    Y el histórico es inmutable

    Ejemplos:
      | tipo      | base | destino | valor   | fecha      |
      | compra    | USD  | GTQ     | 7.7800  | 2026-04-30 |
      | venta     | USD  | GTQ     | 7.8500  | 2026-04-30 |
      | promedio  | USD  | GTQ     | 7.8150  | 2026-04-30 |
      | oficial   | USD  | EUR     | 0.9300  | 2026-04-30 |
      | fiscal    | USD  | EUR     | 0.9350  | 2026-04-30 |

  @validation
  Escenario: Bloqueo al desactivar país con organizaciones activas
    Dado que el país "SV" tiene 1 organización activa
    Cuando intento desactivar el país "SV"
    Entonces el sistema rechaza la operación
    Y muestra "No se puede desactivar un país con organizaciones activas (1)"

  @audit
  Escenario: Histórico inmutable de tasas de cambio
    Dado un usuario que registró tasa "USD→GTQ promedio = 7.8150" el "2026-04-30"
    Cuando otro usuario intenta corregir el valor del mismo día
    Entonces el sistema crea una nueva versión con el valor corregido
    Y conserva la versión previa marcada como "obsoleta"
    Y registra evento "FXRateVersioned"
