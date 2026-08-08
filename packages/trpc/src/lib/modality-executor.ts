/**
 * Mapeo modalidad DICOM → code de centro de costo ejecutor.
 * Definido en Wave 10 (imaging.router.ts): 41 centros sembrados, 4 centros de imagen.
 *
 * Extraído a módulo compartido en CC-0016 para que `imaging.router.ts` (orden
 * manual RIS/PACS) e `imaging-request.router.ts` (solicitud del mockup, que
 * crea N ImagingOrder por prestación) resuelvan el mismo centro ejecutor sin
 * duplicar la constante.
 */
export const MODALITY_EXECUTOR_CODE: Partial<Record<string, string>> = {
  CR: "2-IMG-RAY",
  XA: "2-IMG-RAY", // Angiografía también usa sala RX
  MG: "2-IMG-RAY", // Mamografía en mismo servicio radiología
  NM: "2-IMG-RAY", // Nuclear medicine comparte RX en establecimientos pequeños
  US: "2-IMG-USG",
  CT: "2-IMG-TAC",
  MR: "2-IMG-RMN",
  PT: "2-IMG-RMN", // PET/RMN — misma unidad
};
