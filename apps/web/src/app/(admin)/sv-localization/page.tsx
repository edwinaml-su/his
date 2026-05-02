/**
 * US-7.1 / US-7.2 / US-7.4 — /sv-localization
 *
 * Página informativa con contadores del catálogo geográfico y feriados SV
 * más previsualización de los formatters locale (US-7.4). El botón
 * "Recargar seed SV" dispara una Server Action que en MVP solo registra
 * intención (en producción ejecutaría `npm run -w @his/database seed:sv-extra`).
 */
import Link from "next/link";
import { prisma } from "@his/database";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { revalidatePath } from "next/cache";
import {
  formatDateSV,
  formatNumberSV,
  formatCurrencySV,
  formatBitcoinSV,
  SV_LOCALE_INFO,
} from "@/lib/i18n/sv";

export const dynamic = "force-dynamic";

/**
 * Server Action inline — placeholder MVP.
 * En producción ejecutaría `npm run -w @his/database seed:sv-extra`. Aquí
 * solo registramos la intención por log y revalidamos la ruta.
 */
async function reloadSvSeedAction() {
  "use server";
  console.log("[sv-localization] reloadSvSeedAction invoked");
  console.log("[sv-localization] Ejecutar: npm run -w @his/database seed:sv-extra");
  revalidatePath("/sv-localization");
}

export default async function SvLocalizationPage() {
  const country = await prisma.country.findUnique({
    where: { isoAlpha3: "SLV" },
    select: { id: true },
  });

  let deptosCount = 0;
  let muniCount = 0;
  let distritosCount = 0;
  let holidaysCount = 0;
  if (country) {
    [deptosCount, muniCount, distritosCount, holidaysCount] = await Promise.all([
      prisma.geoDivision.count({ where: { countryId: country.id, level: 1, validTo: null } }),
      prisma.geoDivision.count({ where: { countryId: country.id, level: 2, validTo: null } }),
      prisma.geoDivision.count({ where: { countryId: country.id, level: 3, validTo: null } }),
      prisma.holiday.count({ where: { countryId: country.id } }),
    ]);
  }

  // Previews US-7.4 (lado servidor — la fecha se renderiza en TZ SV).
  const today = new Date();
  const numberPreview = formatNumberSV(1234567.89);
  const usdPreview = formatCurrencySV(1234.56, "USD");
  const svcPreview = formatCurrencySV(8750, "SVC");
  const btcPreview = formatBitcoinSV(12345); // 12_345 sats

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Localización El Salvador</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo geográfico, calendario de feriados y formatters es-SV.
            Locale por defecto: <code>{SV_LOCALE_INFO.locale}</code> · TZ:{" "}
            <code>{SV_LOCALE_INFO.timezone}</code> · Moneda:{" "}
            <code>{SV_LOCALE_INFO.currency}</code>.
          </p>
        </div>
        <form action={reloadSvSeedAction}>
          <Button type="submit" variant="outline">
            Recargar seed SV
          </Button>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Departamentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{deptosCount}</p>
            <p className="text-xs text-muted-foreground">Nivel 1 · MINSAL/RNPN</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Municipios
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{muniCount}</p>
            <p className="text-xs text-muted-foreground">Reforma 2024 (D.L. 426)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Distritos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{distritosCount}</p>
            <p className="text-xs text-muted-foreground">Nivel 3 · pendiente seed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Feriados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{holidaysCount}</p>
            <p className="text-xs text-muted-foreground">
              <Link href="/sv-localization/holidays" className="underline">
                Ver detalle
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Formatters es-SV (US-7.4)</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Fecha</dt>
              <dd className="font-mono text-lg">{formatDateSV(today)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Número</dt>
              <dd className="font-mono text-lg">{numberPreview}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">USD</dt>
              <dd className="font-mono text-lg">{usdPreview}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">SVC (colón)</dt>
              <dd className="font-mono text-lg">{svcPreview}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Bitcoin (12 345 sats)</dt>
              <dd className="font-mono text-lg">{btcPreview}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-muted-foreground">Calendarios PAI</dt>
              <dd className="text-sm">
                Calendario de vacunación PAI alineado a feriados nacionales SV.
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
