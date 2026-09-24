import { z } from "zod";

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your organizer name").max(200, "Use 200 characters or fewer"),
  contactEmail: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  contactPhone: z.string().trim().max(32, "Use 32 characters or fewer").refine(
    (value) => !value || (/^\+?[0-9 ()-]+$/.test(value) && /^[0-9]{7,15}$/.test(value.replace(/\D/g, ""))),
    "Enter a phone number with 7–15 digits",
  ),
  description: z.string().trim().max(2000, "Use 2,000 characters or fewer"),
  payoutProvider: z.enum(["", "sandbox_bank", "sandbox_wallet"]),
  payoutReference: z.string().trim().refine(
    (value) => !value || /^demo_[A-Za-z0-9_-]{3,64}$/.test(value),
    "Use demo_ followed by 3–64 letters, numbers, hyphens or underscores",
  ),
}).superRefine((values, context) => {
  if (values.payoutReference && !values.payoutProvider) {
    context.addIssue({ code: "custom", path: ["payoutProvider"], message: "Choose a simulation provider" });
  }
  if (values.payoutProvider && !values.payoutReference) {
    context.addIssue({ code: "custom", path: ["payoutReference"], message: "Enter a demo account reference" });
  }
});

export type ProfileValues = z.infer<typeof profileSchema>;
