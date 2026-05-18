/**
 * Estilos compartidos para formularios PDF de contingencia.
 * Separado de route.ts para facilitar el testing y reutilización.
 */
import { StyleSheet } from "@react-pdf/renderer";

export function createStyles() {
  return StyleSheet.create({
    page: {
      fontFamily: "Helvetica",
      fontSize: 10,
      paddingTop: 30,
      paddingBottom: 40,
      paddingHorizontal: 36,
      color: "#111",
    },
    header: {
      borderBottom: "2px solid #1a3c6e",
      paddingBottom: 8,
      marginBottom: 12,
    },
    titulo: {
      fontSize: 14,
      fontFamily: "Helvetica-Bold",
      color: "#1a3c6e",
      marginBottom: 2,
    },
    subtitulo: {
      fontSize: 9,
      color: "#666",
      marginBottom: 4,
    },
    nota: {
      fontSize: 8,
      color: "#888",
      fontStyle: "italic",
    },
    seccion: {
      marginBottom: 12,
    },
    seccionTitulo: {
      fontSize: 11,
      fontFamily: "Helvetica-Bold",
      color: "#1a3c6e",
      marginBottom: 6,
      borderBottom: "1px solid #ccc",
      paddingBottom: 2,
    },
    campo: {
      marginBottom: 8,
    },
    campoLabel: {
      fontSize: 9,
      color: "#444",
      marginBottom: 2,
    },
    lineaEscritura: {
      borderBottom: "1px solid #999",
      height: 16,
      marginBottom: 2,
    },
    lineaCorta: {
      borderBottom: "1px solid #999",
      height: 16,
      width: "40%",
      marginBottom: 2,
    },
    lineaLarga: {
      borderBottom: "1px solid #999",
      height: 36,
      marginBottom: 2,
    },
    filaDoble: {
      flexDirection: "row",
      gap: 12,
      marginBottom: 6,
    },
    campoMitad: {
      flex: 1,
    },
    opcionesContainer: {
      flexDirection: "column",
      gap: 4,
      marginTop: 2,
    },
    opcion: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    checkbox: {
      width: 10,
      height: 10,
      border: "1px solid #555",
    },
    opcionTexto: {
      fontSize: 9,
    },
    firmas: {
      flexDirection: "row",
      gap: 24,
      marginTop: 20,
      marginBottom: 12,
    },
    firmaBloque: {
      flex: 1,
    },
    lineaFirma: {
      borderTop: "1px solid #333",
      marginBottom: 4,
      marginTop: 24,
    },
    firmaLabel: {
      fontSize: 8,
      fontFamily: "Helvetica-Bold",
      color: "#444",
    },
    firmaSubLabel: {
      fontSize: 7,
      color: "#888",
    },
    pie: {
      position: "absolute",
      bottom: 20,
      left: 36,
      right: 36,
      borderTop: "1px solid #ddd",
      paddingTop: 4,
    },
    pieTexto: {
      fontSize: 7,
      color: "#aaa",
      textAlign: "center",
    },
  });
}
