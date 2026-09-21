/**
 * GET /api/contingencia/forms/{tipo}.pdf
 * US.F2.7.28 — Formularios imprimibles para contingencia.
 *
 * Tipos soportados: signos_vitales, indicaciones_medicas, evolucion, triaje.
 * Devuelve PDF con @react-pdf/renderer (generación en pdf-generator.tsx).
 */
import { type NextRequest, NextResponse } from "next/server";
import { type TipoFormulario, generarFormularioPdf } from "./pdf-generator";
import { getTenantContext } from "@/lib/auth/session";
import { prisma } from "@his/database";

const TIPOS_VALIDOS: readonly TipoFormulario[] = [
  "signos_vitales",
  "indicaciones_medicas",
  "evolucion",
  "triaje",
];

function isTipoValido(tipo: string): tipo is TipoFormulario {
  return (TIPOS_VALIDOS as readonly string[]).includes(tipo);
}

export async function GET(_req: NextRequest, props: { params: Promise<{ tipo: string }> }) {
  const params = await props.params;
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

  // CC-B — nombre real de la organización, best-effort. Este endpoint es de
  // CONTINGENCIA (NTEC Art. 44): si la sesión/BD no responde, la impresión en
  // papel NO debe bloquearse — generarFormularioPdf ya trae su propio fallback.
  let organizationName: string | undefined;
  try {
    const tenant = await getTenantContext();
    if (tenant) {
      const organization = await prisma.organization.findUnique({
        where: { id: tenant.organizationId },
        select: { tradeName: true, legalName: true },
      });
      organizationName = organization?.tradeName ?? organization?.legalName;
    }
  } catch {
    // Contingencia: sin sesión/BD disponible, se sigue con el fallback.
  }

  const buffer = await generarFormularioPdf(tipo, organizationName);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="contingencia_${tipo}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
