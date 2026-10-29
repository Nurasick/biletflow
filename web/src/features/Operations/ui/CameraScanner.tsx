import { Alert, Button } from "antd";
import { Camera, CameraOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type QrDetector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type QrDetectorConstructor = { new (options: { formats: string[] }): QrDetector; getSupportedFormats?: () => Promise<string[]> };
const detectorConstructor = () => (window as Window & { BarcodeDetector?: QrDetectorConstructor }).BarcodeDetector;

export const CameraScanner = ({ disabled, onQr }: { disabled: boolean; onQr: (qr: string) => void }) => {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<"ops.cameraUnavailable" | "ops.cameraDenied" | null>(null);

  const stop = useCallback(() => {
    generation.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setActive(false);
    setOpening(false);
  }, []);

  useEffect(() => () => {
    generation.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stop]);

  useEffect(() => {
    if (!active) return;
    const Detector = detectorConstructor();
    if (!Detector) return;
    let detector: QrDetector;
    try { detector = new Detector({ formats: ["qr_code"] }); }
    catch { stop(); setError("ops.cameraUnavailable"); return; }
    let cancelled = false;
    let frame = 0;
    let lastAttempt = 0;
    const readFrame = async (time: number) => {
      if (cancelled) return;
      if (document.visibilityState === "hidden" || disabled) {
        stop();
        return;
      }
      if (video.current && video.current.readyState >= 2 && time - lastAttempt > 350) {
        lastAttempt = time;
        try {
          const found = await detector.detect(video.current);
          if (cancelled) return;
          const qr = found.find((result) => result.rawValue)?.rawValue;
          if (qr) {
            stop();
            onQr(qr);
            return;
          }
        } catch {
          if (cancelled) return;
          stop();
          setError("ops.cameraUnavailable");
          return;
        }
      }
      if (!cancelled) frame = requestAnimationFrame(readFrame);
    };
    frame = requestAnimationFrame(readFrame);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [active, disabled, onQr, stop]);

  const start = async () => {
    setError(null);
    const Detector = detectorConstructor();
    if (!Detector || !navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setError("ops.cameraUnavailable");
      return;
    }
    const attempt = ++generation.current;
    setOpening(true);
    try {
      if (Detector.getSupportedFormats && !(await Detector.getSupportedFormats()).includes("qr_code")) {
        if (attempt === generation.current) { setError("ops.cameraUnavailable"); setOpening(false); }
        return;
      }
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (attempt !== generation.current) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      if (attempt === generation.current) setActive(true);
    } catch {
      if (attempt !== generation.current) return;
      stop();
      setError("ops.cameraDenied");
    } finally {
      if (attempt === generation.current) setOpening(false);
    }
  };

  return <div className="mt-4 space-y-3">
    <Button disabled={disabled} loading={opening} onClick={active ? stop : () => void start()}
      icon={active ? <CameraOff size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}>
      {t(active ? "ops.cameraStop" : "ops.cameraStart")}
    </Button>
    <video ref={video} autoPlay playsInline muted aria-label={t("ops.cameraPreview")}
      className={`${active ? "block" : "hidden"} max-h-72 w-full rounded-xl bg-[#101828] object-contain`} />
    {active && <p role="status" className="text-sm text-[#667085]">{t("ops.cameraActive")}</p>}
    {error && <Alert type="info" showIcon title={t(error)} />}
  </div>;
};
