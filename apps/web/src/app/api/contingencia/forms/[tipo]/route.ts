/**
 * GET /api/contingencia/forms/{tipo}.pdf
 * US.F2.7.28 — Formularios imprimibles para contingencia.
 *
 * Tipos soportados: signos_vitales, indicaciones_medicas, evolucion, triaje.
 * Devuelve PDF con @react-pdf/renderer (generación en pdf-generator.tsx).
 */
import { type NextRequest, NextResponse } from "next/server";
import { type TipoFormulario, generarFormularioPdf } from "./pdf-generator";

const TIPOS_VALIDOS: readonly TipoFormulario[] = [
  "signos_vitales",
  "indicaciones_medicas",
  "evolucion",
  "triaje",
];

function isTipoValido(tipo: string): tipo is TipoFormulario {
  return (TIPOS_VALIDOS as readonly string[]).includes(tipo);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { tipo: string } },
) {
  // Normalizar: quitar .pdf si viene con extensión
  const tipo = params.tipo.replace(/\.pdf$/, "");

  if (!isTipoValido(tipo)) {
    return NextResponse.json(
      {
        error: `Tipo de formulario inválido. Tipos válidos: ${TIPOS_VALIDOS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const buffer = await generarFormularioPdf(tipo);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="contingencia_${tipo}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
