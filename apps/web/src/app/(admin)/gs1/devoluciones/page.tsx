/**
 * GS1 Proceso F — Devoluciones de inventario.
 *
 * Vista split en tres pestañas:
 *   - Solicitadas       (estado = 'solicitado')
 *   - Pendiente recepción (estado = 'en_transito' | 'autorizado')
 *   - Históricas        (estado = 'recibido' | 'rechazado')
 *
 * Punto de entrada Server Component — delega renders cliente.
 */
import { Suspense } from "react";
import { DevolucionesView } from "./_components/devoluciones-view";

export const metadata = { title: "Devoluciones GS1 | AVANTE HIS" };

export default function DevolucionesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Cargando...</p>}>
      <DevolucionesView />
    </Suspense>
  );
}
