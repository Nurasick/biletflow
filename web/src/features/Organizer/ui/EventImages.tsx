import { Button } from "antd";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { validationMessage } from "../../../i18n/validation";
import { readEventImage, validateEventImageFiles } from "../model/eventImages";
import { EVENT_IMAGE_TYPES, MAX_EVENT_IMAGES } from "../model/eventSchema";
import type { EventImage } from "../model/eventSchema";

type EventImagesProps = {
  images: EventImage[];
  onChange: (images: EventImage[]) => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
};

export const EventImages = ({ images, onChange, onBusyChange, disabled }: EventImagesProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const readingRef = useRef(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async (files: File[]) => {
    if (!files.length || readingRef.current || disabled) return;
    const issue = validateEventImageFiles(files, images.length);
    setError(issue);
    if (issue) return;
    readingRef.current = true;
    setReading(true);
    onBusyChange(true);
    try {
      const added = await Promise.all(files.map(readEventImage));
      onChange([...images, ...added]);
    } catch {
      setError("validation.eventImageRead");
    } finally {
      readingRef.current = false;
      setReading(false);
      onBusyChange(false);
    }
  };

  return (
    <div>
      <input ref={inputRef} id="event-images" type="file" multiple accept={EVENT_IMAGE_TYPES.join(",")}
        className="sr-only" disabled={disabled || reading || images.length >= MAX_EVENT_IMAGES}
        aria-label={t("organizerEvent.addImages")} aria-invalid={Boolean(error)}
        aria-describedby={`event-images-hint${error ? " event-images-error" : ""}`}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void addFiles(files);
        }} />
      <div className="rounded-lg border border-dashed border-[#D0D5DD] bg-[#F5F5F0] px-5 py-6 text-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}>
        <ImagePlus size={24} aria-hidden="true" className="mx-auto text-[#667085]" />
        <p id="event-images-hint" className="my-3 text-xs leading-5 text-[#667085]">{t("organizerEvent.imagesHint")}</p>
        <Button htmlType="button" onClick={() => inputRef.current?.click()}
          disabled={disabled || reading || images.length >= MAX_EVENT_IMAGES}
          icon={reading ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : undefined}>
          {reading ? t("organizerEvent.readingImages") : t("organizerEvent.addImages")}
        </Button>
      </div>
      {error && <p role="alert" id="event-images-error" className="mt-2 text-xs text-red-600">
        {validationMessage(t, { type: "client", message: error })}
      </p>}
      {images.length > 0 && <ul aria-label={t("organizerEvent.images")} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((image, index) => (
          <li key={image.id} className="overflow-hidden rounded-lg border border-[#D0D5DD]">
            <div className="relative">
              <img src={image.dataUrl} alt={image.name} className="aspect-video w-full object-cover" />
              <button type="button" onClick={() => { setError(null); onChange(images.filter((item) => item.id !== image.id)); }}
                disabled={disabled || reading} aria-label={t("organizerEvent.removeImage", { name: image.name })}
                className="absolute right-2 top-2 rounded-full border border-[#D0D5DD] bg-white p-2 text-[#101828] focus-visible:outline-2 focus-visible:outline-[#FF5C35] disabled:opacity-50">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="p-3">
              <p title={image.name} className="truncate text-xs text-[#667085]">{image.name}</p>
              {index === 0 ? <span className="mt-2 inline-block rounded bg-[#FFF0EA] px-2 py-1 text-[10px] font-semibold text-[#A93216]">{t("organizerEvent.coverImage")}</span> : (
                <button type="button" disabled={disabled || reading} className="mt-2 text-xs font-semibold text-[#A93216] disabled:opacity-50"
                  onClick={() => onChange([image, ...images.filter((item) => item.id !== image.id)])}>
                  {t("organizerEvent.makeCover")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>}
    </div>
  );
};
