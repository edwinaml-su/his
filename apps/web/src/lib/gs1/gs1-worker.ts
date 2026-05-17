/**
 * Web Worker: decodifica DataMatrix via @zxing/browser en hilo separado.
 * Recibe un ImageBitmap o ImageData y devuelve el texto crudo GS1.
 *
 * Este archivo es importado como Worker en useGs1Scanner:
 *   new Worker(new URL('./gs1-worker.ts', import.meta.url))
 */

import { MultiFormatReader, BarcodeFormat, DecodeHintType, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } from "@zxing/library";

type WorkerInMessage =
  | { type: "decode-bitmap"; bitmap: ImageBitmap }
  | { type: "decode-imagedata"; data: ImageData };

type WorkerOutMessage =
  | { type: "result"; text: string }
  | { type: "error"; message: string };

const reader = new MultiFormatReader();
const hints = new Map<DecodeHintType, unknown>();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
hints.set(DecodeHintType.TRY_HARDER, true);
reader.setHints(hints);

self.addEventListener("message", async (event: MessageEvent<WorkerInMessage>) => {
  try {
    let imageData: ImageData;

    if (event.data.type === "decode-bitmap") {
      const bmp = event.data.bitmap;
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);
    } else {
      imageData = event.data.data;
    }

    const luminance = new RGBLuminanceSource(
      new Uint8ClampedArray(imageData.data.buffer),
      imageData.width,
      imageData.height,
    );
    const bitmap = new BinaryBitmap(new HybridBinarizer(luminance));
    const result = reader.decode(bitmap);

    const out: WorkerOutMessage = { type: "result", text: result.getText() };
    self.postMessage(out);
  } catch (e) {
    const out: WorkerOutMessage = {
      type: "error",
      message: e instanceof Error ? e.message : "Error desconocido en worker",
    };
    self.postMessage(out);
  }
});
