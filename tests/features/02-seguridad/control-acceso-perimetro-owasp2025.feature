# language: es
# Épica: Hardening OWASP Top 10:2025 — A01 Broken Access Control / A10 Mishandling of Exceptional Conditions
# Historias cubiertas: sin US formal de backlog — remediación de auditoría de seguridad
# Fuente: docs/audit/2026-08-17_owasp_2025_remediacion.md (§A01, §A10)
# Persona principal: todo usuario tenant-scoped; P8 super-admin/CISO como responsable de la garantía
# Valor de negocio: el aislamiento entre organizaciones y la protección de rutas privadas
# no dependen únicamente de que el código de aplicación esté bien escrito — la base de
# datos y el punto de entrada de la API los garantizan aunque algo más falle.

@critical @security @a01 @a10 @owasp2025 @es-SV
Característica: Control de acceso reforzado en el perímetro (multi-tenant y borde de API)
  Como usuario de una organización del HIS
  Quiero que mis datos permanezcan aislados de otras organizaciones y que el
  sistema nunca conceda acceso por error
  Para que una falla de programación o de infraestructura no exponga información
  clínica de un tenant a otro, ni abra rutas privadas sin sesión válida.

  Antecedentes:
    Dado que existen dos organizaciones activas: "Complejo Hospitalario Avante" (org A)
      y "Hospital Regional Santa Ana" (org B)
    Y cada organización tiene su propia bandeja de tareas clínicas, órdenes de
      nutrición y censo de camas
    Y inicio sesión como "enfermera.turno@avante.sv", con rol "enfermeria" y
      asignada únicamente a "Complejo Hospitalario Avante"

  # ----------------------------------------------------------------------
  # Aislamiento multi-tenant garantizado por la base de datos (A01)
  # ----------------------------------------------------------------------
  @rls @multitenant
  Esquema del escenario: Un usuario de la organización A no ve datos clínicos de la organización B
    Cuando consulto "<pantalla>" de mi organización
    Entonces sólo veo registros de "Complejo Hospitalario Avante"
    Y ningún registro de "Hospital Regional Santa Ana" aparece en el resultado

    Ejemplos:
      | pantalla                        |
      | mi bandeja de tareas clínicas   |
      | las órdenes de nutrición activas|
      | el censo de camas               |

  @critical @rls @multitenant @edge-case
  Escenario: El aislamiento se sostiene aunque el filtro de la aplicación falle
    Dado que, por un defecto hipotético del código de la pantalla, la consulta
      "olvida" limitar el resultado a mi organización
    Cuando esa consulta se ejecuta contra la base de datos
    Entonces la base de datos igual no devuelve ningún registro de
      "Hospital Regional Santa Ana"
    Y el control real de aislamiento es la base de datos, no el filtro de la pantalla

  # ----------------------------------------------------------------------
  # Gate de borde del lote de peticiones a la API (A01)
  # ----------------------------------------------------------------------
  @critical @gate @edge-case
  Escenario: Una petición sin sesión que mezcla una consulta pública y una protegida se rechaza completa
    Dado que no tengo sesión iniciada
    Cuando envío en una sola petición una consulta pública (catálogo de países)
      junto con una protegida (listado de pacientes)
    Entonces el sistema rechaza la petición completa
    Y NO recibo ni siquiera el resultado de la consulta pública
    Y se me redirige a iniciar sesión

  @gate @edge-case
  Escenario: Una petición con formato de lote malformado se trata como no pública
    Dado que no tengo sesión iniciada
    Cuando envío una petición cuyo formato de lote no es reconocible por el sistema
    Entonces el sistema la trata como una petición protegida
    Y la rechaza por falta de sesión, sin evaluar su contenido

  # ----------------------------------------------------------------------
  # Fail-closed ante error del gate de borde (A10)
  # ----------------------------------------------------------------------
  @critical @fail-closed
  Escenario: Un fallo interno del gate de borde no concede acceso a una ruta protegida
    Dado que no tengo sesión iniciada
    Y el mecanismo que evalúa la sesión en el borde de la aplicación falla internamente
    Cuando intento abrir una pantalla clínica protegida, por ejemplo el expediente de un paciente
    Entonces se me redirige a iniciar sesión
    Y en ningún caso se me muestra la pantalla protegida

  @fail-closed
  Escenario: Las rutas públicas se siguen sirviendo aunque el gate de borde falle
    Dado que el mecanismo que evalúa la sesión en el borde de la aplicación falla internamente
    Cuando visito una página pública, por ejemplo la pantalla de inicio de sesión
    Entonces la página pública se muestra con normalidad

  @fail-closed @edge-case
  Esquema del escenario: La redirección ante fallo del gate distingue personal de pacientes del portal
    Dado que llego desde "<origen>" sin sesión iniciada
    Y el gate de borde falla internamente al intentar evaluar mi sesión
    Cuando intento abrir una pantalla protegida
    Entonces se me redirige a "<destino>"

    Ejemplos:
      | origen                          | destino         |
      | el HIS interno (personal)       | /login          |
      | el portal de pacientes          | /portal/login    |
