/** Reads one QR code from the current video frame, or null when none is visible. */
export type QrReader = { kind: "native" | "javascript"; read: (video: HTMLVideoElement) => Promise<string | null> };

type NativeDetector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type NativeDetectorConstructor = {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

/** Frames are scaled down to this width before decoding: QR codes held up to a
 * webcam stay readable, and decoding stays fast on low-end laptops. */
export const DECODE_MAX_WIDTH = 640;

export const decodeSize = (width: number, height: number, maxWidth = DECODE_MAX_WIDTH) => {
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, maxWidth / width);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

const nativeReader = async (): Promise<QrReader | null> => {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return null;
  try {
    if (Detector.getSupportedFormats && !(await Detector.getSupportedFormats()).includes("qr_code")) return null;
    const detector = new Detector({ formats: ["qr_code"] });
    return {
      kind: "native",
      read: async (video) => (await detector.detect(video)).find((result) => result.rawValue)?.rawValue ?? null,
    };
  } catch {
    return null;
  }
};

const javascriptReader = async (): Promise<QrReader | null> => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  // Loaded on demand: browsers with BarcodeDetector never download it.
  const { default: jsQR } = await import("jsqr");
  return {
    kind: "javascript",
    read: async (video) => {
      const size = decodeSize(video.videoWidth, video.videoHeight);
      if (!size) return null;
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      context.drawImage(video, 0, 0, size.width, size.height);
      const frame = context.getImageData(0, 0, size.width, size.height);
      return jsQR(frame.data, size.width, size.height, { inversionAttempts: "attemptBoth" })?.data || null;
    },
  };
};

export const createQrReader = async (): Promise<QrReader | null> => (await nativeReader()) ?? javascriptReader();
