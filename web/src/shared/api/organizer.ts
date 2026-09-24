import { DUMMY_ERRORS, DUMMY_PROFILE, DUMMY_SESSION } from "../../features/Organizer/model/dummyData";
import { profileSchema } from "../../features/Organizer/model/profileSchema";
import type { ProfileValues } from "../../features/Organizer/model/profileSchema";

const storageKey = (userId: number) => `biletflow.demo.organizer-profile.${userId}`;
const delay = () => new Promise((resolve) => setTimeout(resolve, 350));

const requireOrganizer = (userId: number) => {
  if (!DUMMY_SESSION || DUMMY_SESSION.id !== userId || DUMMY_SESSION.role !== "organizer") {
    throw new Error("Only organizers can access this profile.");
  }
};

// Local demo adapter: nothing here calls the backend or moves real money.
export const organizerApi = {
  currentSession: () => DUMMY_SESSION,
  getProfile: async (userId: number): Promise<ProfileValues> => {
    requireOrganizer(userId);
    await delay();
    if (DUMMY_ERRORS.load) throw new Error("Couldn't load your profile. Please try again.");
    try {
      const saved = localStorage.getItem(storageKey(userId));
      return saved ? profileSchema.parse(JSON.parse(saved)) : { ...DUMMY_PROFILE };
    } catch {
      throw new Error("Couldn't read your saved profile. Check that browser storage is available, then try again.");
    }
  },
  saveProfile: async (userId: number, values: ProfileValues): Promise<ProfileValues> => {
    requireOrganizer(userId);
    await delay();
    if (DUMMY_ERRORS.save) throw new Error("Couldn't save your changes. Please try again.");
    const profile = profileSchema.parse(values);
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(profile));
    } catch {
      throw new Error("Couldn't save to this browser. Check that browser storage is available, then try again.");
    }
    return profile;
  },
};
