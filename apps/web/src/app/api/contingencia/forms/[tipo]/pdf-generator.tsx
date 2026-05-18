/**
 * Generador de PDFs de contingencia — JSX de @react-pdf/renderer.
 * Separado de route.ts porque route.ts es .ts (no acepta JSX).
 */
import { renderToBuffer, Document, Page, Text, View } from "@react-pdf/renderer";
import { createStyles } from "./pdf-styles";

export type TipoFormulario =
  | "signos_vitales"
  | "indicaciones_medicas"
  | "evolucion"
  | "triaje";

interface CampoFormulario {
  label: string;
  tipo: "texto" | "numero" | "select";
  opciones?: string[];
}

const CAMPOS: Record<TipoFormulario, CampoFormulario[]> = {
  signos_vitales: [
    { label: "TA Sistólica (mmHg)", tipo: "numero" },
    { label: "TA Diastólica (mmHg)", tipo: "numero" },
    { label: "Frecuencia Cardíaca (lpm)", tipo: "numero" },
    { label: "Frecuencia Respiratoria (rpm)", tipo: "numero" },
    { label: "Temperatura (°C)", tipo: "numero" },
    { label: "SpO2 (%)", tipo: "numero" },
    { label: "Escala de Dolor (0-10)", tipo: "numero" },
    { label: "Peso (kg)", tipo: "numero" },
    { label: "Talla (cm)", tipo: "numero" },
    { label: "Observaciones", tipo: "texto" },
  ],
  indicaciones_medicas: [
    { label: "Medicamento 1 — Nombre", tipo: "texto" },
    { label: "Dosis / Vía / Frecuencia", tipo: "texto" },
    { label: "Medicamento 2 — Nombre", tipo: "texto" },
    { label: "Dosis / Vía / Frecuencia", tipo: "texto" },
    { label: "Medicamento 3 — Nombre", tipo: "texto" },
    { label: "Dosis / Vía / Frecuencia", tipo: "texto" },
    { label: "Dieta indicada", tipo: "texto" },
    { label: "Restricciones / Cuidados especiales", tipo: "texto" },
    { label: "Observaciones del médico", tipo: "texto" },
  ],
  evolucion: [
    { label: "Subjetivo (S): Síntomas referidos por el paciente", tipo: "texto" },
    { label: "Objetivo (O): Hallazgos al examen físico", tipo: "texto" },
    { label: "Análisis (A): Diagnóstico / Impresión clínica", tipo: "texto" },
    { label: "Plan (P): Conducta / Tratamiento", tipo: "texto" },
    { label: "Diagnóstico CIE-10 (código)", tipo: "texto" },
  ],
  triaje: [
    { label: "Motivo de consulta", tipo: "texto" },
    {
      label: "Nivel de prioridad",
      tipo: "select",
      opciones: [
        "I — Resucitación",
        "II — Emergencia",
        "III — Urgencia",
        "IV — Menos urgente",
        "V — No urgente",
      ],
    },
    { label: "TA Sistólica / Diastólica", tipo: "texto" },
    { label: "Frecuencia Cardíaca", tipo: "numero" },
    { label: "Temperatura (°C)", tipo: "numero" },
    { label: "SpO2 (%)", tipo: "numero" },
    { label: "Escala de Dolor (0-10)", tipo: "numero" },
    { label: "Destino asignado", tipo: "texto" },
    { label: "Observaciones de triaje", tipo: "texto" },
  ],
};

export const TITULOS: Record<TipoFormulario, string> = {
  signos_vitales: "Formulario de Signos Vitales — Contingencia",
  indicaciones_medicas: "Formulario de Indicaciones Médicas — Contingencia",
  evolucion: "Formulario de Evolución Médica (SOAP) — Contingencia",
  triaje: "Formulario de Triaje Manchester — Contingencia",
};

export async function generarFormularioPdf(tipo: TipoFormulario): Promise<Buffer> {
  const estilos = createStyles();
  const campos = CAMPOS[tipo];
  const titulo = TITULOS[tipo];

  const doc = (
    <Document
      title={titulo}
      author="Avante Complejo Hospitalario — HIS"
      subject="Formulario de contingencia operativa"
      keywords="contingencia, papel, HIS, NTEC"
    >
      <Page size="LETTER" style={estilos.page}>
        {/* Encabezado */}
        <View style={estilos.header}>
          <Text style={estilos.titulo}>{titulo}</Text>
          <Text style={estilos.subtitulo}>
            Sistema HIS — Avante Complejo Hospitalario
          </Text>
          <Text style={estilos.nota}>
            Formulario de contingencia operativa (NTEC Art. 44). Digitalizar al restaurar el sistema.
          </Text>
        </View>

        {/* Datos del paciente */}
        <View style={estilos.seccion}>
          <Text style={estilos.seccionTitulo}>Datos del Paciente</Text>
          <View style={estilos.filaDoble}>
            <View style={estilos.campoMitad}>
              <Text style={estilos.campoLabel}>Nombre completo</Text>
              <View style={estilos.lineaEscritura} />
            </View>
            <View style={estilos.campoMitad}>
              <Text style={estilos.campoLabel}>N° Expediente / DUI</Text>
              <View style={estilos.lineaEscritura} />
            </View>
          </View>
          <View style={estilos.filaDoble}>
            <View style={estilos.campoMitad}>
              <Text style={estilos.campoLabel}>Fecha y hora de registro (papel)</Text>
              <View style={estilos.lineaEscritura} />
            </View>
            <View style={estilos.campoMitad}>
              <Text style={estilos.campoLabel}>Servicio / Cama</Text>
              <View style={estilos.lineaEscritura} />
            </View>
          </View>
        </View>

        {/* Campos del formulario */}
        <View style={estilos.seccion}>
          <Text style={estilos.seccionTitulo}>Datos Clínicos</Text>
          {campos.map((campo, idx) => (
            <View key={idx} style={estilos.campo}>
              <Text style={estilos.campoLabel}>{campo.label}</Text>
              {campo.tipo === "select" && campo.opciones ? (
                <View style={estilos.opcionesContainer}>
                  {campo.opciones.map((op, oi) => (
                    <View key={oi} style={estilos.opcion}>
                      <View style={estilos.checkbox} />
                      <Text style={estilos.opcionTexto}>{op}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View
                  style={
                    campo.tipo === "texto" ? estilos.lineaLarga : estilos.lineaCorta
                  }
                />
              )}
            </View>
          ))}
        </View>

        {/* Firmas */}
        <View style={estilos.firmas}>
          <View style={estilos.firmaBloque}>
            <View style={estilos.lineaFirma} />
            <Text style={estilos.firmaLabel}>Firma y sello — Profesional de salud</Text>
            <Text style={estilos.firmaSubLabel}>Nombre / Junta de Vigilancia</Text>
          </View>
          <View style={estilos.firmaBloque}>
            <View style={estilos.lineaFirma} />
            <Text style={estilos.firmaLabel}>Firma — Paciente o responsable</Text>
            <Text style={estilos.firmaSubLabel}>Nombre / Parentesco (si aplica)</Text>
          </View>
        </View>

        {/* Pie de página */}
        <View style={estilos.pie}>
          <Text style={estilos.pieTexto}>
            Formulario generado por HIS | Digitalizar al restaurar el sistema |
            Período de contingencia: ___________________________
          </Text>
        </View>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
