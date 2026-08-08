/**
 * CC-0016 — `/imaging/new` (form legado de UUIDs manuales) queda reemplazado
 * por la pestaña «Nueva Solicitud» del módulo (`/imaging`). Redirect server-side.
 */
import { redirect } from "next/navigation";

export default function NewImagingOrderPage() {
  redirect("/imaging");
}
