import { EVENT_IMAGE_TYPES, MAX_EVENT_IMAGES, MAX_IMAGE_BYTES } from "./eventSchema";
import type { EventImage } from "./eventSchema";

export const validateEventImageFiles = (files: readonly File[], existingCount: number): string | null => {
  if (files.length + existingCount > MAX_EVENT_IMAGES) return "validation.eventImageCount";
  if (files.some((file) => !EVENT_IMAGE_TYPES.includes(file.type))) return "validation.eventImageType";
  if (files.some((file) => file.size === 0 || file.size > MAX_IMAGE_BYTES)) return "validation.eventImageSize";
  return null;
};

export const readEventImage = async (file: File): Promise<EventImage> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error());
    reader.onerror = () => reject(new Error());
    reader.onabort = () => reject(new Error());
    reader.readAsDataURL(file);
  });
  // MIME metadata alone does not guarantee that the selected file is an image.
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject(new Error());
    image.onerror = () => reject(new Error());
    image.src = dataUrl;
  });
  return { id: crypto.randomUUID(), name: file.name, dataUrl };
};
