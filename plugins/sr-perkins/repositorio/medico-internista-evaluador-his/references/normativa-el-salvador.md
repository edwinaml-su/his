# Marco normativo sanitario de El Salvador aplicable al HIS

Qué exige cada norma y qué debe demostrar el HIS. Usa esta tabla como columna vertebral de la matriz de cumplimiento. **Advertencia de vigencia**: la institucionalidad sanitaria salvadoreña se reformó fuerte en 2023–2024 (creación de la Superintendencia de Regulación Sanitaria, nueva ley de datos personales); cuando una conclusión dependa del texto vigente, verifica con búsqueda web en fuentes oficiales (asamblea.gob.sv, salud.gob.sv, asp.salud.gob.sv, mh.gob.sv) antes de afirmarla.

## 1. Código de Salud (Decreto Legislativo N.º 955, 1988, con reformas)

Marco general: obligaciones de establecimientos y profesionales, secreto profesional, notificación obligatoria de enfermedades, defunciones, ejercicio profesional autorizado.

Exigir al HIS:
- Registro del profesional responsable de cada acto con su número de junta de vigilancia (JVPM y demás juntas profesionales) — solo usuarios con perfil profesional habilitado firman actos clínicos.
- Soporte a **notificación epidemiológica obligatoria**: marcaje de diagnósticos CIE-10 de notificación (VIH, dengue, tuberculosis, etc.) y generación del reporte al nivel correspondiente (sistema de vigilancia del MINSAL).
- Flujo de defunciones: constancia de defunción con los datos que exige el registro del estado familiar, causa de muerte codificada (CIE-10).
- Confidencialidad (secreto profesional) reflejada en control de acceso.

## 2. Ley de Deberes y Derechos de los Pacientes y Prestadores de Servicios de Salud (Decreto N.º 307, 2016)

La norma más directamente exigible al expediente en el HIS. Puntos operativos:

- **Expediente clínico obligatorio, único e individual** por paciente; el paciente tiene **derecho a acceder a su expediente y a obtener resumen/constancias**: el HIS debe poder imprimir/exportar el expediente o resumen clínico de forma legible y completa.
- **Consentimiento informado** previo a procedimientos (quirúrgicos, invasivos, riesgo): documentado, específico, revocable; excepciones de urgencia vital documentadas. El HIS gestiona formatos, firma y archivo por episodio.
- **Atención de emergencia sin condicionamiento**: prohibido condicionar la atención de urgencia a pago o trámite; el HIS no puede tener bloqueos administrativos que impidan registrar/atender una urgencia.
- **Información al paciente** (diagnóstico, pronóstico, tratamiento, alternativas): la epicrisis e indicaciones de alta entregables al paciente.
- **Confidencialidad** de la información de salud; acceso por necesidad de atención.
- Derecho a **segunda opinión** y a rechazar tratamiento (alta exigida con constancia — el HIS debe tener ese formato).

## 3. Ley del Sistema Nacional Integrado de Salud (Decreto N.º 302, 2019)

Organiza el sistema (MINSAL rector, RIISS, ISSS, etc.). Relevante para HIS de hospitales que participan de redes: referencia y retorno entre establecimientos con los formatos de la red, reportes al ente rector, interoperabilidad con los sistemas nacionales cuando el MINSAL lo disponga (el MINSAL usa expediente clínico electrónico nacional —SIS/historia clínica electrónica— en su red; un HIS privado debe al menos producir la información que se le exija).

## 4. Superintendencia de Regulación Sanitaria (ley aprobada 2023, funciones desde 2024)

Absorbió funciones del **Consejo Superior de Salud Pública (CSSP)** y de la **Dirección Nacional de Medicamentos (DNM)**: autorización/registro de establecimientos de salud, registro sanitario de productos, vigilancia. Implicaciones para el HIS:

- Los datos de habilitación del establecimiento (número de registro/autorización) aparecen en papelería y documentos emitidos.
- Farmacia y medicamentos: cumplimiento de lo que antes vigilaba la DNM (ver Ley de Medicamentos).
- Al citar al "CSSP" o la "DNM" en entregables, aclarar que sus funciones pasaron a la Superintendencia (verificar el estado actual si es determinante).

## 5. Ley de Medicamentos (Decreto N.º 1008, 2012) y normativa de farmacia

- Prescripción con requisitos (nombre genérico/DCI, presentación, dosis, datos y firma del prescriptor): las recetas que imprime/emite el HIS deben cumplir el formato.
- **Estupefacientes y psicotrópicos**: receta especial/retenida, libros de control; el módulo de farmacia debe llevar el control de entradas/salidas por producto controlado con saldo y trazabilidad por paciente y prescriptor.
- Farmacovigilancia: registro y reporte de reacciones adversas (RAM).

## 6. Ley para la Protección de Datos Personales (Decreto N.º 144, noviembre 2024) y Ley de Ciberseguridad y Seguridad de la Información

Los **datos de salud son datos personales sensibles**. Autoridad: Agencia de Ciberseguridad del Estado (ACE). Exigir al HIS:

- Base de licitud y finalidad: los datos clínicos se usan para la atención; usos secundarios (investigación, mercadeo) requieren consentimiento o base legal.
- Derechos ARCO (acceso, rectificación, cancelación, oposición) operables: el hospital debe poder responder una solicitud de acceso/rectificación del titular; la "cancelación" en salud se modula por la obligación de conservar el expediente — documentar el criterio.
- Medidas de seguridad: control de acceso por rol y mínimo privilegio, cifrado en tránsito (y de respaldos), bitácora de accesos al expediente (quién vio qué y cuándo — no solo quién escribió), gestión de incidentes y notificación de brechas.
- Transferencias: si el HIS es nube extranjera, evaluar el régimen de transferencia internacional de datos y el contrato con el proveedor (encargado de tratamiento).
- Plazo: la ley dio período de adecuación; verificar reglamento y plazos vigentes al evaluar.

## 7. Ley de Firma Electrónica (Decreto N.º 133, 2015)

- Firma electrónica simple y **certificada** (esta última con equivalencia funcional a la manuscrita, mediante proveedores acreditados). Para el expediente clínico electrónico sin papel, evaluar qué tipo de firma usa el HIS y su robustez probatoria (usuario+contraseña con bitácora vs. firma certificada); recomendar validación legal para actos de mayor riesgo (consentimientos, epicrisis, constancias).
- Si el hospital imprime y firma a mano, el HIS debe producir los documentos completos para firma y permitir adjuntar el escaneado.

## 8. Normativa fiscal: DTE y Código Tributario

Ver detalle operativo en `cobros-cuentas.md` §3. Base: reformas al Código Tributario que establecen los Documentos Tributarios Electrónicos transmitidos al Ministerio de Hacienda, con calendario de obligatoriedad ya ejecutado por segmentos. Verificar en mh.gob.sv (portal de factura electrónica) los requisitos técnicos vigentes de emisión, contingencia e invalidación.

## 9. Normativa técnica del MINSAL (lineamientos y normas)

El MINSAL publica normas y lineamientos técnicos en su Centro Virtual de Documentación Regulatoria (asp.salud.gob.sv/regulacion). Los más citables al evaluar un HIS:

- **Lineamientos técnicos de triage en hospitales de la RIISS** (clasificación de 5 niveles) — base para el módulo de triage.
- **Lineamientos técnicos para los registros clínicos de enfermería** (acuerdo reformado 2025) — estructura de notas y kárdex de enfermería.
- Normas/lineamientos de **expediente clínico** y de estadísticas/documentos médicos — contenido mínimo del expediente, epicrisis, hoja de referencia y retorno.
- Lista de verificación de **cirugía segura** (adopción de la práctica OMS).
- Lineamientos del **Sistema Integrado de Salud** (versión 2026 publicada).

Para hospitales privados estos lineamientos aplican según lo que su marco de autorización y el ente rector exijan, pero son el estándar de referencia razonable en El Salvador: un HIS que los cumple está bien parado ante cualquier inspección. En la matriz de cumplimiento, cita el lineamiento por nombre y busca su versión vigente en asp.salud.gob.sv antes de citar números de acuerdo.

## 10. Otras normas a tener en el radar según el caso

- **ISSS**: si el hospital atiende derechohabientes por convenio, los formatos y reportes del ISSS aplican al episodio.
- Código Procesal Penal / obligación de aviso en lesiones por hechos delictivos (registro médico-legal).
- Ley Reguladora de las Actividades Relativas a las Drogas (control complementario de sustancias).
- Normativa laboral (incapacidades: constancias que el HIS debe emitir).
- NIIF/normativa contable para la interfaz cuenta de paciente → contabilidad.

## Cómo usar este marco en la matriz de cumplimiento

Cada fila de la matriz: norma → artículo/obligación concreta → qué debe hacer el HIS → estado observado (Cumple / Cumple parcial / No cumple / No verificado / No aplica) → evidencia → riesgo si no cumple → recomendación. No inventes números de artículo: si no tienes el texto a mano, cita la norma y la obligación en términos de su contenido, o búscala antes de citar el artículo.
