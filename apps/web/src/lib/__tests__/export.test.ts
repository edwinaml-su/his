// @vitest-environment jsdom
/**
 * Tests de utilidades de exportación tabular.
 *
 * Las funciones que dependen de browser APIs (write-excel-file/browser, jsPDF)
 * se testean con mocks de los dynamic imports para no cargar dependencias pesadas.
 * Las funciones puramente síncronas se testean directamente.
 */
import { describe, it, expect, vi } from "vitest";
import { exportToCsv, timestampedFilename, type ExportColumn } from "../export";

// ─────────────────────────────────────────────────────────────────────────────
// timestampedFilename
// ─────────────────────────────────────────────────────────────────────────────

describe("timestampedFilename", () => {
  it("produce el formato <base>-YYYY-MM-DD-HHmm.<ext>", () => {
    const result = timestampedFilename("reporte", "xlsx");
    expect(result).toMatch(/^reporte-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx$/);
  });

  it("funciona con distintas extensiones", () => {
    expect(timestampedFilename("datos", "csv")).toMatch(/\.csv$/);
    expect(timestampedFilename("informe", "pdf")).toMatch(/\.pdf$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportToCsv — solo testea el contenido del Blob; la descarga es efecto
// secundario no observable en unit tests.
// ─────────────────────────────────────────────────────────────────────────────

describe("exportToCsv", () => {
  it("genera un Blob con BOM UTF-8 y cabeceras en la primera línea", async () => {
    const capturedParts: string[] = [];
    const OrigBlob = globalThis.Blob;
    globalThis.Blob = class MockBlob extends OrigBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        capturedParts.push(...(parts as string[]));
      }
    } as unknown as typeof Blob;

    // Stubs mínimos para downloadBlob().
    URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
    URL.revokeObjectURL = vi.fn();

    const columns: ExportColumn<{ name: string; age: number }>[] = [
      { header: "Nombre", accessor: (r) => r.name },
      { header: "Edad", accessor: (r) => r.age },
    ];
    exportToCsv([{ name: "Ana", age: 30 }], columns, "test.csv");

    const text = capturedParts.join("");
    expect(text).toContain("Nombre,Edad");
    expect(text).toContain("Ana,30");
    // BOM UTF-8 al inicio.
    expect(text.startsWith("﻿")).toBe(true);

    globalThis.Blob = OrigBlob;
  });

  it("escapa celdas que contienen comas o comillas dobles", () => {
    const capturedParts: string[] = [];
    const OrigBlob = globalThis.Blob;
    globalThis.Blob = class MockBlob extends OrigBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        capturedParts.push(...(parts as string[]));
      }
    } as unknown as typeof Blob;

    URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
    URL.revokeObjectURL = vi.fn();

    const columns: ExportColumn<{ label: string }>[] = [
      { header: "Etiqueta", accessor: (r) => r.label },
    ];
    exportToCsv(
      [{ label: 'Coma, aquí' }, { label: 'Con "comillas"' }],
      columns,
      "out.csv",
    );

    const text = capturedParts.join("");
    expect(text).toContain('"Coma, aquí"');
    expect(text).toContain('"Con ""comillas"""');

    globalThis.Blob = OrigBlob;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportToXlsx — mock de write-excel-file/browser
// ─────────────────────────────────────────────────────────────────────────────

describe("exportToXlsx", () => {
  it("invoca writeExcelFile con los datos correctos y llama .toFile(filename)", async () => {
    const toFileMock = vi.fn().mockResolvedValue(undefined);
    const writeExcelFileMock = vi.fn().mockReturnValue({ toFile: toFileMock });

    vi.doMock("write-excel-file/browser", () => ({ default: writeExcelFileMock }));

    // Re-importar después del mock para que tome el stub.
    const { exportToXlsx } = await import("../export");

    const columns: ExportColumn<{ val: number }>[] = [
      { header: "Valor", accessor: (r) => r.val },
    ];
    await exportToXlsx([{ val: 42 }], columns, "salida.xlsx", "Hoja1");

    expect(writeExcelFileMock).toHaveBeenCalledOnce();
    // Primer arg: sheetData (array de arrays) con cabecera + datos.
    const [sheetData, opts] = writeExcelFileMock.mock.calls[0] as [unknown[][], { sheet: string; columns: unknown[] }];
    expect(sheetData[0]).toEqual(["Valor"]);
    expect(sheetData[1]).toEqual([42]);
    expect(opts.sheet).toBe("Hoja1");
    expect(toFileMock).toHaveBeenCalledWith("salida.xlsx");

    vi.doUnmock("write-excel-file/browser");
  });

  it("trunca el nombre de hoja a 31 caracteres (límite Excel)", async () => {
    const toFileMock = vi.fn().mockResolvedValue(undefined);
    const writeExcelFileMock = vi.fn().mockReturnValue({ toFile: toFileMock });

    vi.doMock("write-excel-file/browser", () => ({ default: writeExcelFileMock }));

    const { exportToXlsx: exportToXlsx2 } = await import("../export");

    const columns: ExportColumn<Record<string, never>>[] = [];
    await exportToXlsx2([], columns, "f.xlsx", "A".repeat(40));

    const [, opts] = writeExcelFileMock.mock.calls[0] as [unknown, { sheet: string }];
    expect(opts.sheet.length).toBe(31);

    vi.doUnmock("write-excel-file/browser");
  });
});
