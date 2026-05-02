/**
 * US-7.2 — /sv-localization/holidays
 *
 * Tabla simple read-only del calendario de feriados nacionales SV.
 * El "CRUD básico" se reduce a lectura en MVP — la mutación se delega al
 * seed `seed-sv-extra` (idempotente, regenera la lista canónica).
 */
import Link from "next/link";
import { prisma } from "@his/database";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { formatDateSV } from "@/lib/i18n/sv";

export const dynamic = "force-dynamic";

export default async function SvHolidaysPage({
  searchParams,
}: {
  searchParams?: { year?: string };
}) {
  const yearParam = Number(searchParams?.year);
  const year = Number.isFinite(yearParam) && yearParam > 2000 ? yearParam : 2026;

  const country = await prisma.country.findUnique({
    where: { isoAlpha3: "SLV" },
    select: { id: true },
  });

  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const holidays = country
    ? await prisma.holiday.findMany({
        where: { countryId: country.id, date: { gte: start, lt: end } },
        orderBy: { date: "asc" },
      })
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Feriados nacionales SV — {year}</h1>
          <p className="text-sm text-muted-foreground">
            Calendario derivado del seed extendido. Para cargar otro año ajusta
            <code className="mx-1">?year=YYYY</code> en la URL.
          </p>
        </div>
        <Link href="/sv-localization" className="text-sm underline">
          ← Volver
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Calendario {year}</CardTitle>
        </CardHeader>
        <CardContent>
          {holidays.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay feriados cargados para {year}. Ejecuta{" "}
              <code>npm run -w @his/database seed:sv-extra</code>.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Fecha</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-32">Tipo</TableHead>
                  <TableHead className="w-24">Recurrente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-mono">{formatDateSV(h.date)}</TableCell>
                    <TableCell>{h.name}</TableCell>
                    <TableCell>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">
                        {h.kind}
                      </span>
                    </TableCell>
                    <TableCell>{h.recurring ? "Sí" : "No"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
