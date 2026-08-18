/**
 * gln-resolver.ts — Resolución en cascada del GLN de ubicación de un paciente.
 *
 * ADR 0019 D8: ni ServiceUnit ni Bed tenían columna GLN; se agregaron
 * (`glnCodigo`, sql/199_epcis_patient_movement.sql, materializado por @DBA en
 * schema.prisma) para poder resolver el WHERE de los eventos EPCIS de
 * movimiento de paciente. El catálogo `ece.gs1_gln` puede seguir vacío en un
 * establecimiento dado — por eso esto es deliberadamente no-bloqueante:
 * devuelve null si no hay match, y el evento se persiste igual con
 * `where_data.readPoint`/`bizLocation` en null (WHERE parcial, no se
 * sacrifica el resto del evento — ver ADR 0019 D8).
 */

type PrismaLike = {
  bed: {
    findUnique: (args: {
      where: { id: string };
      select: { glnCodigo: true };
    }) => Promise<{ glnCodigo: string | null } | null>;
  };
  serviceUnit: {
    findUnique: (args: {
      where: { id: string };
      select: { glnCodigo: true };
    }) => Promise<{ glnCodigo: string | null } | null>;
  };
};

/**
 * Resuelve el GLN aplicable para un movimiento de paciente, en cascada:
 * cama → servicio → null (sin fallback de establecimiento: ece.establecimiento
 * no tiene columna GLN propia y no se agrega en este ADR — ver ADR 0019 D8,
 * sección de riesgos).
 */
export async function resolveLocationGln(
  tx: PrismaLike,
  input: { bedId?: string | null; serviceUnitId?: string | null },
): Promise<string | null> {
  if (input.bedId) {
    const bed = await tx.bed.findUnique({
      where: { id: input.bedId },
      select: { glnCodigo: true },
    });
    if (bed?.glnCodigo) return bed.glnCodigo;
  }
  if (input.serviceUnitId) {
    const su = await tx.serviceUnit.findUnique({
      where: { id: input.serviceUnitId },
      select: { glnCodigo: true },
    });
    if (su?.glnCodigo) return su.glnCodigo;
  }
  return null;
}
