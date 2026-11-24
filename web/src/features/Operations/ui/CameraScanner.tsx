import { Alert, Button } from "antd";
import { Camera, CameraOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { createQrReader } from "../model/qrReader";
import type { QrReader } from "../model/qrReader";

const SCAN_INTERVAL_MS = 350;

export const CameraScanner = ({ disabled, onQr }: { disabled: boolean; onQr: (qr: string) => void }) => {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const [reader, setReader] = useState<QrReader | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<"ops.cameraUnavailable" | "ops.cameraDenied" | null>(null);
  const active = reader !== null;

  const stop = useCallback(() => {
    generation.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setReader(null);
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
    if (!reader) return;
    let cancelled = false;
    let frame = 0;
    let lastAttempt = 0;
    const readFrame = async (time: number) => {
      if (cancelled) return;
      if (document.visibilityState === "hidden" || disabled) {
        stop();
        return;
      }
      if (video.current && video.current.readyState >= 2 && time - lastAttempt > SCAN_INTERVAL_MS) {
        lastAttempt = time;
        try {
          const qr = await reader.read(video.current);
          if (cancelled) return;
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
  }, [reader, disabled, onQr, stop]);

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setError("ops.cameraUnavailable");
      return;
    }
    const attempt = ++generation.current;
    setOpening(true);
    try {
      // Native BarcodeDetector where it exists (Chrome, Edge, Android); otherwise
      // a JavaScript decoder so Firefox and Safari can scan through the webcam too.
      const qrReader = await createQrReader();
      if (attempt !== generation.current) return;
      if (!qrReader) { setError("ops.cameraUnavailable"); setOpening(false); return; }
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (attempt !== generation.current) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      if (attempt === generation.current) setReader(qrReader);
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
      className={`${active ? "block" : "hidden"} max-h-72 w-full rounded-xl bg-ink object-contain`} />
    {active && <p role="status" className="text-sm text-muted">{t("ops.cameraActive")}</p>}
    {error && <Alert type="info" showIcon title={t(error)} />}
  </div>;
};
