"use client";

/**
 * OrgSwitcherClient — wrapper cliente del componente UI <OrgSwitcher>.
 *
 * Conecta la lista de organizaciones (vía tRPC `organization.listMine`)
 * con el Server Action `setOrganization` que setea las cookies de tenant.
 * El layout server-side recibe `currentOrgId` y se lo pasa como prop —
 * así el primer render NO parpadea esperando red.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { OrgSwitcher, type OrgOption } from "@his/ui/components/OrgSwitcher";
import { trpc } from "@/lib/trpc/react";
import { setOrganization } from "@/app/actions/set-organization";

interface Props {
  currentOrgId: string | null;
}

export function OrgSwitcherClient({ currentOrgId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const orgs = trpc.organization.listMine.useQuery(undefined, {
    staleTime: 60_000,
  });

  const options: OrgOption[] = React.useMemo(() => {
    return (orgs.data ?? []).map((o) => ({ id: o.id, name: o.tradeName ?? o.legalName }));
  }, [orgs.data]);

  const current = React.useMemo<OrgOption | null>(() => {
    if (!currentOrgId) return null;
    const match = options.find((o) => o.id === currentOrgId);
    return match ?? null;
  }, [options, currentOrgId]);

  const handleSwitch = React.useCallback(
    async (org: OrgOption) => {
      if (org.id === currentOrgId || busy) return;
      setBusy(true);
      try {
        await setOrganization(org.id);
        router.refresh();
      } catch (err) {
        // TODO(Sprint 2): mostrar toast con error legible
        console.error("[OrgSwitcher] error:", err);
      } finally {
        setBusy(false);
      }
    },
    [currentOrgId, busy, router],
  );

  return <OrgSwitcher current={current} options={options} onSwitch={handleSwitch} />;
}
