import { profileSchema } from "../../features/Organizer/model/profileSchema";
import type { ProfileValues } from "../../features/Organizer/model/profileSchema";
import { ApiError, api } from "./auth";

export type PayoutAccount = {
  provider: "sandbox_bank" | "sandbox_wallet";
  external_account_ref: string;
  status: string;
  is_simulated: boolean;
};

export type OrganizerProfile = {
  id: number;
  display_name: string;
  contact_email: string;
  contact_phone: string | null;
  description: string | null;
  verification_status: "unverified" | "pending" | "verified" | "rejected";
  payout_account: PayoutAccount | null;
};

const toValues = (profile: OrganizerProfile): ProfileValues => ({
  displayName: profile.display_name,
  contactEmail: profile.contact_email,
  contactPhone: profile.contact_phone ?? "",
  description: profile.description ?? "",
  payoutProvider: profile.payout_account?.provider ?? "",
  payoutReference: profile.payout_account?.external_account_ref ?? "",
});

const toBody = (values: ProfileValues) => ({
  display_name: values.displayName,
  contact_email: values.contactEmail,
  contact_phone: values.contactPhone || null,
  description: values.description || null,
  payout_provider: values.payoutProvider || null,
  payout_reference: values.payoutReference || null,
});

// Being an organizer is having a profile (01-identity.md): the first save
// creates it, and with it access to the organizer workspace.
export const organizerApi = {
  /** The saved profile, or null when this account has not created one yet. */
  getRecord: async (): Promise<OrganizerProfile | null> => {
    try {
      return await api.get<OrganizerProfile>("/organizer/profile");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  getProfile: async (fallbackEmail = ""): Promise<ProfileValues> => {
    const profile = await organizerApi.getRecord();
    return profile ? toValues(profile) : {
      displayName: "", contactEmail: fallbackEmail, contactPhone: "",
      description: "", payoutProvider: "", payoutReference: "",
    };
  },
  saveProfile: async (values: ProfileValues): Promise<ProfileValues> =>
    toValues(await api.put<OrganizerProfile>("/organizer/profile", toBody(profileSchema.parse(values)))),
  /** Simulated identity verification (§3.2); real KYC is out of scope. */
  verify: () => api.post<OrganizerProfile>("/organizer/profile/verify"),
};
