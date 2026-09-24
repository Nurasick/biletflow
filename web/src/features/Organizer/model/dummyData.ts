import type { ProfileValues } from "./profileSchema";

export type DemoSession = {
  id: number;
  role: "organizer" | "attendee";
};

// Frontend preview only. Use null to preview a guest, or "attendee" for denied access.
// Replace this session and the dummy API when organizer endpoints are available.
export const DUMMY_SESSION: DemoSession | null = { id: 1, role: "organizer" };

export const DUMMY_PROFILE: ProfileValues = {
  displayName: "KBTU Music Club",
  contactEmail: "music.club@example.com",
  contactPhone: "+7 (700) 123-45-67",
  description: "Bringing students together through live music, local artists and unforgettable nights in Almaty.",
  payoutProvider: "",
  payoutReference: "",
};

// Switch these on to preview retry and failed-save states without a backend.
export const DUMMY_ERRORS = { load: false, save: false };
