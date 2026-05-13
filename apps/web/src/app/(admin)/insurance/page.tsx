"use client";

/**
 * §25 Insurer Agreements — Listado de aseguradoras (catálogo + tenant).
 */
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type InsurerKind = "PUBLIC" | "PRIVATE" | "SELF_INSURED";

const KIND_OPTIONS: { value: InsurerKind | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "PUBLIC", label: "Pública" },
  { value: "PRIVATE", label: "Privada" },
  { value: "SELF_INSURED", label: "Auto-asegurada" },
];

export default function InsurancePage() {
  const [kind, setKind] = React.useState<InsurerKind | "ALL">("ALL");
  const [search, setSearch] = React.useState("");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = { activeOnly: true };
    if (kind !== "ALL") input.kind = kind;
    if (search.trim()) input.search = search.trim();
    return input;
  }, [kind, search]);

  const query = trpc.insurance.insurer.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Aseguradoras</h1>
          <p className="text-sm text-muted-foreground">
            Convenios y planes de aseguradoras (§25).
          </p>
        </div>
        <Button asChild>
          <Link href="/insurance/new">Nueva aseguradora</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-kind">Tipo</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as InsurerKind | "ALL")}
              >
                <SelectTrigger id="filter-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-search">Búsqueda</Label>
              <Input
                id="filter-search"
                placeholder="Código, nombre o NIT"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Catálogo</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin aseguradoras.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>NIT</TableHead>
                  <TableHead>Alcance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono">{i.code}</TableCell>
                    <TableCell>{i.name}</TableCell>
                    <TableCell>{i.kind}</TableCell>
                    <TableCell>{i.taxId ?? "—"}</TableCell>
                    <TableCell>
                      {i.organizationId === null ? "Global" : "Tenant"}
                    </TableCell>
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
