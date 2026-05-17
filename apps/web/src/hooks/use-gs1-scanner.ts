"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { parseGs1String, type Gs1Data, type Gs1ParseResult } from "@/lib/gs1/parse-ai";

export type ScannerState =
  | { status: "idle" }
  | { status: "scanning" }
  | { status: "done"; result: Gs1ParseResult }
  | { status: "error"; message: string };

export interface UseGs1ScannerReturn {
  state: ScannerState;
  /** Decodifica un File (imagen) vía Web Worker y parsea el resultado GS1. */
  scanFile: (file: File) => Promise<void>;
  /** Alimenta directamente un string ya decodificado (útil para testing / mocks). */
  parseRaw: (raw: string) => void;
  reset: () => void;
}

export function useGs1Scanner(): UseGs1ScannerReturn {
  const [state, setState] = useState<ScannerState>({ status: "idle" });
  const workerRef = useRef<Worker | null>(null);

  // Instanciar worker lazy — solo en el browser.
  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../lib/gs1/gs1-worker.ts", import.meta.url),
        { type: "module" },
      );
    }
    return workerRef.current;
  }, []);

  // Limpiar worker al desmontar.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const scanFile = useCallback(
    async (file: File): Promise<void> => {
      setState({ status: "scanning" });
      try {
        const bitmap = await createImageBitmap(file);
        const worker = getWorker();

        const text = await new Promise<string>((resolve, reject) => {
          const handler = (event: MessageEvent<{ type: string; text?: string; message?: string }>) => {
            worker.removeEventListener("message", handler);
            if (event.data.type === "result" && event.data.text !== undefined) {
              resolve(event.data.text);
            } else {
              reject(new Error(event.data.message ?? "Worker error"));
            }
          };
          worker.addEventListener("message", handler);
          worker.postMessage({ type: "decode-bitmap", bitmap }, [bitmap]);
        });

        const result = parseGs1String(text);
        setState({ status: "done", result });
      } catch (e) {
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Error al escanear imagen",
        });
      }
    },
    [getWorker],
  );

  const parseRaw = useCallback((raw: string): void => {
    const result = parseGs1String(raw);
    setState({ status: "done", result });
  }, []);

  const reset = useCallback((): void => {
    setState({ status: "idle" });
  }, []);

  return { state, scanFile, parseRaw, reset };
}
