import { z } from "zod";

import { isEventTimeZone, parseLocalDateTime, resolveEventDateTime } from "./eventDateTime";

export const EVENT_CATEGORIES = ["concert", "conference", "sport", "theater", "other"] as const;
export const EVENT_VISIBILITIES = ["public", "unlisted", "private"] as const;
export const MAX_EVENT_IMAGES = 5;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const EVENT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const eventImageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // A newly picked file (a data URL, uploaded on save) or an image already
  // stored on the server (its URL; the id is then "server-<image id>").
  dataUrl: z.union([
    z.string().max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32, "validation.eventImageSize")
      .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "validation.eventImageType"),
    z.string().max(512).regex(/^https?:\/\/\S+$/, "validation.eventImageType"),
  ]),
});
export type EventImage = z.infer<typeof eventImageSchema>;

const dateTime = z.string().refine((value) => parseLocalDateTime(value) !== null, "validation.eventDateTime");
const optionalDateTime = z.union([z.literal(""), dateTime]);

export const eventSchema = z.object({
  title: z.string().trim().min(1, "validation.eventTitle").max(300, "validation.eventTitleMax"),
  description: z.string().trim().min(1, "validation.eventDescription").max(10_000, "validation.eventDescriptionMax"),
  refundPolicy: z.string().trim().max(2_000, "validation.eventRefundPolicyMax"),
  category: z.enum(EVENT_CATEGORIES, { error: "validation.eventCategory" }),
  images: z.array(eventImageSchema).max(MAX_EVENT_IMAGES, "validation.eventImageCount"),
  venueName: z.string().trim().min(1, "validation.eventVenue").max(300, "validation.eventVenueMax"),
  venueAddress: z.string().trim().min(1, "validation.eventAddress").max(2000, "validation.eventAddressMax"),
  timeZone: z.string().refine(isEventTimeZone, "validation.eventTimeZone"),
  startsAt: dateTime,
  endsAt: dateTime,
  registrationOpensAt: optionalDateTime,
  registrationClosesAt: optionalDateTime,
  capacity: z.string().trim().refine((value) => value === "" || (
    /^[1-9]\d*$/.test(value) && Number(value) <= 2_147_483_647
  ), "validation.eventCapacity"),
  visibility: z.enum(EVENT_VISIBILITIES, { error: "validation.eventVisibility" }),
}).superRefine((values, context) => {
  if (!isEventTimeZone(values.timeZone)) return;
  const instants: Partial<Record<"startsAt" | "endsAt" | "registrationOpensAt" | "registrationClosesAt", number>> = {};
  for (const field of ["startsAt", "endsAt", "registrationOpensAt", "registrationClosesAt"] as const) {
    if (!values[field] || parseLocalDateTime(values[field]) === null) continue;
    const matches = resolveEventDateTime(values[field], values.timeZone);
    if (matches.length !== 1) {
      context.addIssue({ code: "custom", path: [field], message: matches.length
        ? "validation.eventDateAmbiguous" : "validation.eventDateNonexistent" });
    } else {
      instants[field] = matches[0];
    }
  }
  const { startsAt, endsAt, registrationOpensAt, registrationClosesAt } = instants;
  if (startsAt !== undefined && endsAt !== undefined && endsAt <= startsAt) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "validation.eventEndOrder" });
  }
  if (registrationOpensAt !== undefined && registrationClosesAt !== undefined && registrationClosesAt <= registrationOpensAt) {
    context.addIssue({ code: "custom", path: ["registrationClosesAt"], message: "validation.eventRegistrationOrder" });
  }
  for (const field of ["registrationOpensAt", "registrationClosesAt"] as const) {
    if (startsAt !== undefined && instants[field] !== undefined && instants[field] > startsAt) {
      context.addIssue({ code: "custom", path: [field], message: "validation.eventRegistrationAfterStart" });
    }
  }
});

export type OrganizerEventValues = z.infer<typeof eventSchema>;

export const emptyOrganizerEvent = (): OrganizerEventValues => ({
  title: "", description: "", refundPolicy: "", category: "other", images: [],
  venueName: "", venueAddress: "", timeZone: "Asia/Almaty", startsAt: "", endsAt: "",
  registrationOpensAt: "", registrationClosesAt: "", capacity: "", visibility: "public",
});
