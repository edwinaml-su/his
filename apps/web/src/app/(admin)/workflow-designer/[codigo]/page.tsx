/**
 * Workflow Designer — Vista de grafo del workflow de un tipo de documento.
 *
 * Server Component: resuelve roleCodes del tenant activo (mismo patrón que
 * `(admin)/layout.tsx` y el documentado en `use-ece-permissions.ts` — Server
 * Component resuelve el tenant y lo pasa como prop al Client Component) y se
 * lo pasa a `WorkflowGrafoView`. Reemplaza el TODO(HG-19) que hardcodeaba
 * `roleCodes=[]` en el Client Component, dejando `canEdit` siempre en false.
 */
import { getTenantContext } from "@/lib/auth/session";
import { WorkflowGrafoView } from "./_components/workflow-grafo-view";

export default async function WorkflowGrafoPage() {
  const tenant = await getTenantContext();
  return <WorkflowGrafoView roleCodes={tenant?.roleCodes ?? []} />;
}
