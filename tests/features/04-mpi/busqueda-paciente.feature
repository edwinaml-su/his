# language: es
# Épica: E4 — MPI
# Historias cubiertas: US-4.3
# TDR: §8.1
# Persona principal: P3 — Admisión, P1 — Médico
# Valor de negocio: Encontrar pacientes en < 300 ms con criterios múltiples para no
# perder tiempo clínico y prevenir duplicados.

@critical @mpi @search @es-SV
Característica: Búsqueda multi-criterio de paciente en MPI
  Como personal de admisión (P3) o médico (P1)
  Quiero buscar por DUI/NIT, nombre, fecha de nacimiento, teléfono o expediente
  Para localizar pacientes existentes rápidamente.

  Antecedentes:
    Dado que el MPI tiene 1 millón de pacientes indexados
    Y existe el paciente "María Elena Hernández López" con MRN "MRN-000123" y DUI "04567823-4"
    Y inicio sesión con rol "admision"

  @smoke @performance
  Escenario: Búsqueda por DUI exacto
    Cuando busco por DUI "04567823-4"
    Entonces se devuelve 1 resultado en menos de 300 ms
    Y veo MRN, nombre completo, fecha de nacimiento, sexo y alergias críticas

  @performance
  Esquema del escenario: Búsqueda por distintos criterios
    Cuando busco por "<criterio>" con valor "<valor>"
    Entonces el resultado contiene al menos 1 coincidencia
    Y la respuesta llega en menos de 300 ms

    Ejemplos:
      | criterio          | valor               |
      | dui               | 04567823-4          |
      | mrn               | MRN-000123          |
      | telefono          | +50377889900        |
      | nombre_apellido   | Hernández López     |
      | fecha_nacimiento  | 1985-03-12          |

  @fuzzy
  Escenario: Búsqueda fonética/aproximada por nombre
    Cuando busco "Maria Hernandez" (sin tildes)
    Entonces el sistema devuelve "María Hernández López" entre los primeros 5 resultados

  @empty
  Escenario: Búsqueda sin coincidencias
    Cuando busco por DUI "99999999-9"
    Entonces el resultado es 0 coincidencias
    Y el sistema sugiere "Registrar paciente nuevo"

  @validation
  Escenario: Búsqueda con menos de 3 caracteres
    Cuando ingreso "Ma" en el buscador
    Entonces el sistema NO ejecuta búsqueda
    Y muestra "Ingrese al menos 3 caracteres"

  @rls
  Escenario: La búsqueda respeta RLS por organización
    Dado que el usuario pertenece a la organización A
    Y existe un paciente solo en la organización B
    Cuando busca por su DUI
    Entonces NO se devuelve resultado
    Y NO se revela existencia
