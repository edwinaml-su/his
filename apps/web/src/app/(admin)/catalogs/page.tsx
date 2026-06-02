/**
 * Hub de catálogos (`/catalogs`) — índice de todos los catálogos transversales
 * administrables. Cada tarjeta enlaza al editor genérico `/catalogs/[slug]`
 * (CatalogTable + CatalogForm con "+ Nuevo" para crear registros).
 *
 * Antes faltaba este `page.tsx`: solo existía la ruta dinámica `[catalog]`, por
 * lo que navegar a `/catalogs` (sin slug) daba 404.
 */
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { CATALOGS, CATALOG_SLUGS } from "./[catalog]/catalog-config";

export default function CatalogsHubPage() {
  const items = [...CATALOG_SLUGS].sort((a, b) =>
    CATALOGS[a].label.localeCompare(CATALOGS[b].label, "es"),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Catálogos</h1>
        <p className="text-sm text-muted-foreground">
          Catálogos transversales de la aplicación. Selecciona uno para consultar,
          crear o editar sus registros.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((slug) => {
          const c = CATALOGS[slug];
          return (
            <Link
              key={slug}
              href={`/catalogs/${slug}`}
              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${c.label} — ${c.description}`}
            >
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{c.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
