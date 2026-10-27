# Operación diaria multisede

## Modelo operativo de Avante que el gerente tiene en mente

- Sedes: hospitales, laboratorios, farmacia, cafetería; clínicas arrendadas a especialistas dentro del complejo; expansión prevista de ~3 laboratorios y 2–3 edificios.
- Médicos internos (generales) por turno en cada sede, cobertura 24 h; especialistas externos con consultorio arrendado que traen pacientes; servicios al ISBM y DoctorSV.
- Continuo de la salud como columna: promoción (chequeos, programas), prevención (vacunas, tamizaje), tratamiento (consulta, emergencia, hospitalización, quirófano), rehabilitación, paliativos.

## Gestión de camas y flujo

1. Censo a hora fija (p. ej., 07:00) por sede: ocupadas, libres, bloqueadas (limpieza, mantenimiento, aislamiento), altas previstas del día.
2. Altas previstas comunicadas antes de las 10:00; alta real registrada en el HIS en el momento; limpieza terminal ≤ 45 min; cama asignada ≤ 60 min.
3. Un solo dueño del tablero de camas por sede (admisión); emergencia y quirófano ven el tablero en tiempo real.
4. Bloqueo de cama solo con causa y hora prevista de liberación.
5. Reglas de escalamiento: ocupación ≥ 90 % → plan de alta temprana y derivación entre sedes; ≥ 95 % → activar plan de sobredemanda.

## Emergencia

- Triage en ≤ 5 min desde la llegada; médico de triage asignado antes de iniciar el turno.
- Metas puerta-médico por nivel; re-evaluación en sala de espera cada 30 min para III–V.
- Indicador de balance: abandonos sin ser vistos; nadie "cierra el reloj" sin atención real.
- Salida de emergencia: decisión de alta o ingreso ≤ 4 h; cama disponible ≤ 1 h desde la decisión.
- La atención de emergencia nunca se condiciona a trámite administrativo (Ley de Deberes y Derechos de los Pacientes); el registro de tiempos es evidencia.

## Quirófano

- Programación cerrada el día anterior a las 14:00; bandejas e implantes verificados la noche anterior (escaneo GS1).
- Paciente en preoperatorio 45 min antes; checklist de cirugía segura obligatorio.
- Primera cirugía puntual; turnover ≤ 30 min; causas de cancelación registradas y revisadas semanalmente.
- Carga automática a la cuenta de implantes e insumos de alto costo por escaneo.

## Laboratorio

- TAT por tipo (urgencia / rutina); lote de reactivo en uso trazado; control de calidad por lote antes de liberar resultados.
- Apertura de laboratorios nuevos: ver `apertura-sedes.md`.

## Farmacia y cafetería

- Farmacia: dispensación con escaneo; controlados con conteo por turno y doble firma; FEFO; devoluciones de piso el mismo día.
- Cafetería: recepción con GTIN, cadena de frío, FEFO; dieta de pacientes conciliada con indicación médica del HIS.

## Dotación por turno

Método (`scripts/ops_toolkit.py dotacion`):

1. Demanda: pacientes por franja (censo, llegadas a emergencia, cirugías) y carga por paciente (horas de cuidado por paciente-día, HCPD, según complejidad).
2. Horas requeridas por turno = Σ pacientes × HCPD por categoría / horas del turno.
3. Factor de ausentismo y vacaciones (p. ej., 1,15–1,25).
4. Mínimo legal y de seguridad por servicio (ratio enfermera-paciente por complejidad; Código de Trabajo: jornadas, descansos, horas extra).
5. Resultado: dotación por turno y por categoría (enfermera, auxiliar, médico interno, técnico), con brecha vs plantilla actual y costo.

## Clínicas arrendadas y médico especialista como cliente

- Operaciones garantiza al especialista: consultorio listo, insumos, agenda, admisión de sus pacientes, cama y quirófano cuando los pide. Medir su experiencia (NPS de médico) y su producción (coordinado con Comercial).
- Reglas de uso del consultorio, mantenimiento y servicios incluidos están en el contrato de arrendamiento (Legal); Operaciones las aplica.

## Servicios al ISBM y DoctorSV

- Cumplir el protocolo y los tiempos del convenio; registrar producción y evidencias que respaldan la facturación; coordinar con Financiera y Comercial.

## Huddle diario y escalamiento

Ver `4dx-ejecucion.md` (huddle) y `plantillas.md` (flujograma de priorización). Ruta: supervisor → jefe de sede → Gerente de Operaciones → comité de gerencias → dirección.
