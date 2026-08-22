# @DrHIS — Ciclo de ingresos: cuentas, cargos, facturación y cobro

Criterios para evaluar el ciclo de ingresos hospitalario como usuario clínico-administrativo. La pregunta de fondo en todo este documento es una sola: **¿todo lo que se hizo al paciente terminó cobrado, y todo lo cobrado se puede sustentar ante una auditoría?**

**Rutas:** `/finance/invoices`, `/finance/price-lists`, `/finance/tipos-cuenta`, `/finance/cost-centers`, `/finance/allocation-rules`, `/finance/reportes`

---

## 1. Apertura y estructura de la cuenta

| # | Requisito | Por qué importa |
|---|---|---|
| 1 | La cuenta se abre **al inicio de la atención**, no al final, y queda anclada al episodio | Una cuenta que se abre al alta pierde todo lo consumido antes |
| 2 | El **tipo de cuenta** (particular, aseguradora, convenio, ISSS) se define al abrirla y determina la lista de precios aplicable | Es el pivote de cobro: si se elige mal, todo el episodio se valora mal |
| 3 | Un paciente puede tener **varias cuentas simultáneas** (ambulatoria y hospitalaria) sin mezclarlas | Mezclarlas es el origen clásico de la factura impugnada |
| 4 | La cuenta sobrevive a traslados de servicio y a la conversión de ambulatorio a hospitalizado | Ver el escenario de conversión en `procesos-hospitalarios.md` |
| 5 | Emergencia: la cuenta se abre **después** de iniciar la atención, sin bloquearla | Obligación legal, no preferencia operativa |

### En este HIS

`TipoCuenta` → `ServicePriceList` es la cadena implementada (CC-0015). El resolver de precios aplica: regla de la lista → ítem del tarifario → precio estándar del catálogo → captura manual con aviso (CC-0021, `packages/trpc/src/lib/price-resolver.ts`).

**Dato para no reportar un falso defecto:** las 1,440 filas de `LabTest` tienen `standardPrice` en NULL en producción. El eslabón de "precio estándar del catálogo" está vacío, así que muchos códigos caen a captura manual. Eso es **falta de carga de datos**, no defecto del sistema — clasificalo así.

---

## 2. Captura de cargos

Es donde se pierde el dinero. Evaluá cada fuente por separado.

| Fuente del cargo | Qué exigir |
|---|---|
| **Consulta / atención** | Que el acto registrado genere el cargo, sin que nadie lo digite aparte |
| **Farmacia** | Que lo dispensado descuente inventario **real** y baje a la cuenta; que la devolución genere la nota de crédito correspondiente |
| **Quirófano** | Tiempo de sala, honorarios, insumos, prótesis y material implantable — con lote donde aplique |
| **Laboratorio e imágenes** | Que el estudio solicitado y realizado se cobre una sola vez, y que el cancelado no se cobre |
| **Estancia** | Que el censo genere el cargo por día-cama según el tipo de cama, y que el traslado a UCI cambie la tarifa desde el momento correcto |
| **Materiales de enfermería** | Que el consumo en piso baje a la cuenta sin hoja de descargo en papel |

Tres reglas que valen por todas:

1. **Cero doble digitación.** Si alguien tiene que volver a escribir en el módulo de facturación algo que ya se registró en el clínico, es hallazgo — y de severidad Alta, porque garantiza pérdida de cargos.
2. **Cero cargos huérfanos.** Todo cargo debe poder rastrearse al acto clínico que lo originó, con responsable y hora.
3. **La anulación no borra.** Un cargo mal hecho se anula dejando rastro; nunca desaparece.

---

## 3. Valorización

| # | Requisito | Por qué importa |
|---|---|---|
| 1 | Un mismo servicio se valora distinto según el tipo de cuenta, **sin duplicar el catálogo** | Duplicar catálogos es cómo se desincronizan los precios |
| 2 | Vigencia por precio y por regla: un tarifario nuevo no reprecia lo ya facturado | Repreciar hacia atrás es una contingencia contable |
| 3 | Descuentos y exoneraciones con **autorización registrada** (quién, cuándo, por qué) | Sin esto no hay control interno |
| 4 | Copago y deducible del asegurado calculados por el sistema, no a mano | El error de copago es el reclamo más frecuente del paciente |

---

## 4. Facturación

| # | Requisito | Por qué importa |
|---|---|---|
| 1 | El comprobante que se emite corresponde al **tipo fiscal correcto** según el receptor (consumidor final, contribuyente, sujeto excluido, exportación) | Emitir el tipo equivocado obliga a anular y reemitir |
| 2 | La factura refleja la cuenta **cerrada**: no se factura con cargos pendientes de capturar | Es la causa raíz de la nota de crédito evitable |
| 3 | Notas de crédito y débito referenciadas al documento original | Sin referencia, la corrección no es trazable |
| 4 | El documento emitido es **inalterable** y se conserva | Requisito fiscal, no preferencia |
| 5 | La facturación electrónica (DTE) cumple el esquema y los tiempos de transmisión que exige el Ministerio de Hacienda | Ver la advertencia de abajo |

### Advertencia sobre DTE en este HIS

El TDR exige explícitamente cumplir con la facturación electrónica del Ministerio de Hacienda (DTE) e implementar los tipos de comprobante salvadoreños — Factura, CCF, Nota de Remisión, Nota de Crédito, Nota de Débito, Comprobante de Liquidación, Comprobante de Retención, Factura Sujeto Excluido y Factura de Exportación (`TDR_HIS_Multipais.md`, líneas 95 y 200).

**La integración con Hacienda quedó fuera del MVP por decisión de arquitectura.** Al evaluar:

- Reportá el estado real con evidencia, no lo asumas en ninguna dirección: verificá qué hay hoy en `accounting.router.ts` y `ledger.router.ts`.
- Si la integración no está, es un **hallazgo Crítico para operar en producción con facturación real**, y a la vez una **decisión conocida y documentada** — decilo así. Un diferimiento consciente no deja de ser un bloqueante de go-live, pero tampoco es un descubrimiento.
- Verificá con búsqueda web la versión vigente del esquema DTE y sus plazos antes de calificar el detalle técnico del cumplimiento.

---

## 5. Aseguradoras y convenios

| # | Requisito | Por qué importa |
|---|---|---|
| 1 | Verificación de cobertura y vigencia **antes** de la atención electiva (nunca en urgencia) | Es el momento en que se puede evitar el rechazo |
| 2 | Autorizaciones previas registradas con número, vigencia y alcance | Sin autorización, el rechazo es seguro |
| 3 | La liquidación al asegurador se arma desde la misma cuenta, sin re-armarla en Excel | Re-armar en Excel es donde se introducen las diferencias |
| 4 | Rechazos y glosas con causal, para poder gestionar la reclamación | Sin causal no hay ciclo de recuperación |
| 5 | Conciliación entre lo facturado, lo aceptado y lo efectivamente pagado | Es lo que responde "¿cuánto nos deben realmente?" |

---

## 6. Cobro y cierre

| # | Requisito | Por qué importa |
|---|---|---|
| 1 | Estado de cuenta del paciente comprensible **antes** del alta | El paciente tiene derecho a saber qué se le cobra |
| 2 | El alta administrativa es distinta del alta médica y no la bloquea | El alta médica es decisión clínica; retenerla por cobro es ilegal |
| 3 | Pagos parciales, anticipos y su aplicación a la cuenta | Sin esto, la cuenta nunca cuadra |
| 4 | Cartera por antigüedad, por pagador y por servicio | Es el reporte que sostiene la operación financiera |

---

## Escenario de evaluación del ciclo completo

Recorré esto de punta a punta antes de dar el ciclo por evaluado:

1. Paciente con seguro llega a emergencia → se atiende **sin verificar cobertura primero**.
2. Se abre cuenta con tipo "aseguradora X"; se verifica cobertura mientras se lo atiende.
3. Sube a hospitalización; se traslada a UCI al segundo día y vuelve a piso al cuarto.
4. Va a quirófano; se le coloca un implante con lote.
5. Farmacia dispensa; se devuelve un medicamento no administrado.
6. Alta médica al sexto día.
7. Se cierra la cuenta, se liquida a la aseguradora con copago al paciente, y se emite el comprobante fiscal.

Al final, respondé con evidencia:

- ¿Los seis días de estancia se cobraron con **la tarifa correcta por tipo de cama y por día**, incluido el cambio a UCI?
- ¿El implante quedó con lote, trazable y cobrado?
- ¿La devolución de farmacia generó la nota de crédito?
- ¿Alguien tuvo que digitar algo dos veces?
- ¿La suma de lo facturado a la aseguradora más el copago **iguala** la cuenta?

Si alguna de estas cinco no la podés responder con un dato del sistema, el ciclo no está evaluado.
