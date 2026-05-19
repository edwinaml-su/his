"use client";

/**
 * BarcodeScanner — wrapper multi-formato para cámara PWA.
 *
 * Usa @zxing/browser y soporta:
 *   - datamatrix  → GS1 medicamentos (GS1 estándar obligatorio)
 *   - code128     → pulseras GSRN legacy
 *   - pdf417      → cédula de identidad SV (DUI)
 *   - qr          → QR genérico
 *   - ean13       → productos legacy EAN-13
 *
 * Selecciona el hint de @zxing BarcodeFormat según los formatos solicitados.
 * Si BarcodeDetector nativa está disponible, la usa; si no, fallback a @zxing.
 *
 * Timeout de 10s sin scan → muestra mensaje y botón Reintentar.
 *
 * US.F2.6.43, US.F2.6.45
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useScanInputType } from "@/hooks/use-scan-input-type";

export type BarcodeFormat = "datamatrix" | "code128" | "pdf417" | "qr" | "ean13";

interface BarcodeScannerProps {
  formats: BarcodeFormat[];
  onScan: (raw: string, format: BarcodeFormat) => void;
  onError?: (err: Error) => void;
  /** Timeout en ms antes de mostrar mensaje de ayuda. Default 10000. */
  timeoutMs?: number;
  className?: string;
}

// Mapeo BarcodeFormat → ZXing BarcodeFormat hint string
const ZXING_FORMAT_MAP: Record<BarcodeFormat, string> = {
  datamatrix: "DATA_MATRIX",
  code128:    "CODE_128",
  pdf417:     "PDF_417",
  qr:         "QR_CODE",
  ean13:      "EAN_13",
};

// Mapeo ZXing result format → BarcodeFormat nuestro
const ZXING_REVERSE_MAP: Partial<Record<string, BarcodeFormat>> = {
  DATA_MATRIX: "datamatrix",
  CODE_128:    "code128",
  PDF_417:     "pdf417",
  QR_CODE:     "qr",
  EAN_13:      "ean13",
};

export function BarcodeScanner({
  formats,
  onScan,
  onError,
  timeoutMs = 10_000,
  className,
}: BarcodeScannerProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const [timedOut, setTimedOut]     = useState(false);
  const [retryKey, setRetryKey]     = useState(0);
  const { notifyCameraScan }        = useScanInputType({ autoDetect: true });

  const handleRetry = useCallback(() => {
    setTimedOut(false);
    setRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let stopped = false;
    let cleanup: (() => void) | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const onScanInternal = (raw: string, format: BarcodeFormat) => {
      if (stopped) return;
      if (timeoutId) clearTimeout(timeoutId);
      notifyCameraScan();
      onScan(raw, format);
    };

    timeoutId = setTimeout(() => {
      if (!stopped) setTimedOut(true);
    }, timeoutMs);

    async function start() {
      // Intentar API nativa BarcodeDetector primero (Chrome 83+)
      if ("BarcodeDetector" in window) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }

          const video = videoRef.current;
          if (!video) return;
          video.srcObject = stream;
          await video.play();

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const detector = new (window as any).BarcodeDetector({
            formats: formats.map((f) => ZXING_FORMAT_MAP[f].toLowerCase()),
          });

          const intervalId = setInterval(async () => {
            if (stopped || !video) { clearInterval(intervalId); return; }
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const results: any[] = await detector.detect(video);
              if (results.length > 0) {
                const r = results[0];
                const fmt = ZXING_REVERSE_MAP[r.format.toUpperCase()] ?? "datamatrix";
                onScanInternal(r.rawValue as string, fmt);
                clearInterval(intervalId);
              }
            } catch { /* detector puede fallar en frames transitorios */ }
          }, 200);

          cleanup = () => {
            clearInterval(intervalId);
            stream.getTracks().forEach((t) => t.stop());
          };
          return;
        } catch (e) {
          // BarcodeDetector no disponible o sin permisos → fallback
        }
      }

      // Fallback: @zxing/browser
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const hints = new Map<number, unknown>();
        // Hint 2 = DecodeHintType.POSSIBLE_FORMATS
        // ZXing BarcodeFormat enum values (hardcoded para evitar import de @zxing/library)
        const ZXING_ENUM: Record<string, number> = {
          DATA_MATRIX: 8,
          CODE_128:    6,
          PDF_417:     10,
          QR_CODE:     11,
          EAN_13:      2,
        };
        const fmtNums = formats.map((f) => ZXING_ENUM[ZXING_FORMAT_MAP[f]] ?? 8).filter(Boolean);
        hints.set(2, fmtNums);

        const reader = new BrowserMultiFormatReader(hints);
        const video  = videoRef.current;
        if (!video) return;

        const controls = await reader.decodeFromVideoDevice(
          undefined,
          video,
          (result, err) => {
            if (stopped) return;
            if (result) {
              const zxFmt = result.getBarcodeFormat?.().toString() ?? "DATA_MATRIX";
              const fmt   = ZXING_REVERSE_MAP[zxFmt.toUpperCase()] ?? "datamatrix";
              onScanInternal(result.getText(), fmt);
            }
            if (err && !(err.message?.includes("NotFoundException"))) {
              onError?.(err as Error);
            }
          },
        );

        cleanup = () => controls.stop();
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    }

    void start();

    return () => {
      stopped = true;
      cleanup?.();
      if (timeoutId) clearTimeout(timeoutId);
    };
  // retryKey fuerza re-mount del efecto cuando el usuario pulsa Reintentar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey, formats.join(","), timeoutMs]);

  return (
    <div className={className}>
      <video
        ref={videoRef}
        className="w-full rounded-lg object-cover"
        style={{ maxHeight: 300 }}
        playsInline
        muted
        aria-label="Vista de cámara para escaneo de código de barras"
      />
      {timedOut && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-sm">
          <p className="font-medium text-amber-800">
            No se detectó código — intente acercarse más o usar la pistola
          </p>
          <button
            onClick={handleRetry}
            className="mt-2 rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
