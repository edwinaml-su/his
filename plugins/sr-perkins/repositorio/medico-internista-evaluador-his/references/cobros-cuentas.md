# Ciclo de ingresos y cobro de cuentas de pacientes

Criterios para evaluar y configurar el manejo de cuentas de pacientes en el HIS. El principio rector: **la cuenta se construye sola desde el registro clínico**. Cada vez que alguien tiene que "pasar cargos" a mano desde papeles al final de la estancia, hay fuga de ingresos, error y retraso de egreso — y es un hallazgo.

## 1. Estructura de la cuenta

- Una cuenta por episodio (emergencia, ambulatorio, CMA, hospitalización), vinculada al expediente único; consultable en tiempo real ("cuenta corriente" del paciente).
- Catálogo de aranceles/tarifas versionado: precios por servicio, procedimiento, insumo, medicamento, derecho de sala, honorarios; vigencias con fecha (la cuenta usa la tarifa vigente a la fecha del acto, no a la fecha del cierre); múltiples listas de precios (particular, aseguradora A, convenio B, exento).
- Clasificación del pagador al abrir el episodio: particular, seguro privado (aseguradora, póliza, deducible, coaseguro, carta aval/preautorización), convenio institucional, subsidio/exoneración con niveles de autorización y trazabilidad de quién exonera qué y por qué.
- Paquetes quirúrgicos/tarifas planas: componentes incluidos, manejo de excedentes (lo no incluido se cobra aparte y visible), y conversión de paquete a cuenta abierta si el caso se complica.

## 2. Captura de cargos (donde se gana o se pierde el dinero)

- Cargo automático en origen: farmacia descarga al dispensar, quirófano al cerrar el acto, laboratorio/imagen al ordenar o al resultar (definir política), derecho de cama por noche/traslado automático desde el censo.
- Insumos de sala: mecanismo práctico de descargo en el punto de atención (códigos de barra, kits preconfigurados por procedimiento con devolución de no usados).
- Honorarios médicos: reglas por acto (cirujano, ayudante, anestesiólogo, interconsulta) según arancel; distinguibles de los cargos del hospital si se liquidan por separado.
- Conciliación clínico-financiera: reporte de actos clínicos registrados sin cargo (fuga) y cargos sin respaldo clínico (riesgo de glosa/reclamo); esta conciliación es una de las pruebas más reveladoras al evaluar un HIS.
- Correcciones: anulación/ajuste de cargos con motivo, autorización por rol y pista de auditoría; nunca borrado físico.

## 3. Facturación — cumplimiento fiscal salvadoreño (DTE)

El Salvador opera facturación electrónica obligatoria mediante **Documentos Tributarios Electrónicos (DTE)** transmitidos al Ministerio de Hacienda (reformas al Código Tributario; calendario de obligatoriedad por segmentos de contribuyentes ya ejecutado). El HIS —o el sistema de facturación con el que se integra— debe:

- Emitir los tipos de DTE que el hospital necesita: **factura de consumidor final**, **comprobante de crédito fiscal (CCF)** para empresas/aseguradoras con NIT, **nota de crédito/débito** para ajustes post-facturación, **factura de exportación** si atiende pacientes del exterior facturados fuera, y **comprobante de retención** cuando aplique.
- Transmitir a Hacienda y gestionar el sello de recepción; **modo de contingencia** cuando no hay conexión (emisión y transmisión posterior conforme al procedimiento de Hacienda) — un hospital no puede dejar de facturar egresos porque se cayó el internet.
- Datos del receptor correctos: NIT/DUI (el DUI es homologado como NIT para personas naturales), nombre, y para CCF los datos fiscales completos; validación de formato antes de transmitir.
- IVA correctamente parametrizado por tipo de servicio según la ley vigente (los servicios de salud tienen tratamientos específicos — verificar la parametrización contra la normativa vigente y el estatus del establecimiento, público vs. privado, en vez de asumir).
- Anulación/invalidación de DTE por el procedimiento oficial (evento de invalidación transmitido), no "borrando la factura".
- Numeración y correlativo controlados por el sistema; representación gráfica del DTE con código QR de consulta.
- Retenciones aplicables (p. ej., renta sobre honorarios de profesionales cuando el hospital actúa como agente de retención) parametrizables.

Si el HIS delega el DTE en un facturador externo, evalúa la **integración**: la cuenta cerrada pasa completa y sin redigitación, y el número de DTE regresa a la cuenta del paciente.

## 4. Cobro, crédito y aseguradoras

- Caja: recibos de anticipo/depósito al ingreso, abonos parciales durante la estancia, liquidación al egreso; arqueo por cajero; múltiples formas de pago; el anticipo se aplica a la cuenta, no se pierde en un cajón.
- Cierre de cuenta al egreso: pre-factura revisable (el "estado de cuenta" que se discute con el paciente o la aseguradora) antes del DTE definitivo; medir el tiempo alta médica → cuenta lista (indicador de demora de egreso por cuenta).
- Aseguradoras: preautorización/carta aval registrada con monto autorizado y alertas al acercarse al tope; desglose según requisitos de cada aseguradora; gestión de glosas/objeciones (respuesta con respaldo clínico desde el expediente); cartera por aseguradora con antigüedad de saldos.
- Emergencia: la atención de urgencia nunca se condiciona a depósito previo (obligación legal); el sistema debe permitir cuenta abierta con pagador "por definir" y regularización posterior.
- Pacientes sin capacidad de pago / trabajo social: flujo de evaluación socioeconómica y exoneración parcial/total con autorización y registro (transparencia y auditoría).
- Cuentas incobrables: clasificación, provisión y castigo con autorización — nunca eliminación del historial.

## 5. Reportes financieros mínimos

Ingresos por servicio/médico/pagador, cuentas abiertas y su antigüedad, cargos capturados vs. facturados, exoneraciones por autorizador, glosas por aseguradora y causa, producción facturada vs. cobrada. Cruce clínico-financiero: egresos del censo vs. cuentas cerradas del mismo período (deben cuadrar; si no cuadran, el HIS tiene episodios sin cuenta o cuentas fantasma).
