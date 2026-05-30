/**
 * Utilidades de exportación tabular: CSV / XLSX / PDF.
 *
 * Patrón:
 *   const columns = [
 *     { header: "Código", accessor: (r) => r.code },
 *     { header: "Nombre", accessor: (r) => r.name },
 *   ];
 *   await exportToXlsx(rows, columns, "centros-costo");
 *
 * - CSV: nativo, sin deps. UTF-8 BOM para compatibilidad Excel.
 * - XLSX: `write-excel-file/browser` — lazy-loaded (~30KB, sin CVEs activos).
 * - PDF: `jspdf` — lazy-loaded; tabla manual (sin jspdf-autotable, no es dep).
 *
 * Los `accessor` reciben la fila y deben devolver `string | number | null`.
 */

export interface ExportColumn<TRow> {
  header: string;
  accessor: (row: TRow) => string | number | null | undefined;
}

function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Construye el nombre con timestamp ISO local (YYYY-MM-DD-HHmm). */
export function timestampedFilename(base: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${base}-${ts}.${ext}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

export function exportToCsv<TRow>(
  rows: TRow[],
  columns: ExportColumn<TRow>[],
  filename: string,
): void {
  const headerLine = columns.map((c) => escapeCsvCell(c.header)).join(",");
  const dataLines = rows.map((r) =>
    columns.map((c) => escapeCsvCell(c.accessor(r))).join(","),
  );
  const csv = [headerLine, ...dataLines].join("\n");
  // BOM UTF-8 para que Excel detecte el encoding correctamente.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// XLSX (lazy import — write-excel-file/browser ~30KB, reemplaza xlsx@0.18.5
// que tenía CVEs activos de Prototype Pollution + ReDoS)
// ─────────────────────────────────────────────────────────────────────────────

export async function exportToXlsx<TRow>(
  rows: TRow[],
  columns: ExportColumn<TRow>[],
  filename: string,
  sheetName = "Datos",
): Promise<void> {
  const writeExcelFile = (await import("write-excel-file/browser")).default;
  // Fila 0: cabeceras; filas 1..n: datos.
  const sheetData = [
    columns.map((c) => c.header as string | number),
    ...rows.map((r) => columns.map((c) => c.accessor(r) ?? "")),
  ];
  // Ancho automático aproximado por columna (en "caracteres", igual que SheetJS wch).
  const colWidths = columns.map((c) => {
    const headerLen = c.header.length;
    const maxRowLen = rows.reduce((max, r) => {
      const v = c.accessor(r);
      return Math.max(max, v == null ? 0 : String(v).length);
    }, 0);
    return { width: Math.min(50, Math.max(8, Math.max(headerLen, maxRowLen) + 2)) };
  });
  await writeExcelFile(sheetData, {
    sheet: sheetName.slice(0, 31), // Excel limita a 31 chars.
    columns: colWidths,
  }).toFile(filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF (lazy import — jspdf ~300KB)
// ─────────────────────────────────────────────────────────────────────────────

export interface PdfExportOptions {
  /** Título visible en la primera línea del documento. */
  title?: string;
  /** Subtítulo opcional (ej. nombre de organización, rango fechas). */
  subtitle?: string;
  /** "landscape" recomendado cuando hay >5 columnas. */
  orientation?: "portrait" | "landscape";
}

export async function exportToPdf<TRow>(
  rows: TRow[],
  columns: ExportColumn<TRow>[],
  filename: string,
  options: PdfExportOptions = {},
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const orientation = options.orientation ?? (columns.length > 5 ? "landscape" : "portrait");
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  let y = margin;

  // Header
  if (options.title) {
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(options.title, margin, y);
    y += 6;
  }
  if (options.subtitle) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(options.subtitle, margin, y);
    y += 5;
  }
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generado: ${new Date().toLocaleString("es-SV")}`, margin, y);
  doc.setTextColor(0);
  y += 6;

  // Distribuir ancho disponible proporcional al max(header, row) por columna.
  const availableW = pageW - margin * 2;
  const colWeights = columns.map((c) => {
    const headerLen = c.header.length;
    const maxRowLen = rows.reduce((max, r) => {
      const v = c.accessor(r);
      return Math.max(max, v == null ? 0 : String(v).length);
    }, 0);
    return Math.max(headerLen, Math.min(maxRowLen, 30)); // cap 30 chars
  });
  const totalWeight = colWeights.reduce((s, w) => s + w, 0);
  const colWidths = colWeights.map((w) => (w / totalWeight) * availableW);

  // Header row
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y, availableW, 7, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  let x = margin;
  columns.forEach((c, i) => {
    doc.text(c.header, x + 1.5, y + 5);
    x += colWidths[i]!;
  });
  y += 7;

  // Data rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const row of rows) {
    if (y + 6 > pageH - margin) {
      doc.addPage();
      y = margin;
    }
    x = margin;
    columns.forEach((c, i) => {
      const v = c.accessor(row);
      const cellW = colWidths[i]!;
      const text = v == null ? "" : String(v);
      // Truncar visualmente si excede el ancho.
      const maxChars = Math.floor(cellW / 1.7);
      const display = text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;
      doc.text(display, x + 1.5, y + 4);
      x += cellW;
    });
    y += 5;
    doc.setDrawColor(230);
    doc.line(margin, y, margin + availableW, y);
  }

  // Footer pie de página
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text(`Página ${p} de ${pages}`, pageW - margin, pageH - 4, { align: "right" });
    doc.setTextColor(0);
  }

  doc.save(filename);
}
