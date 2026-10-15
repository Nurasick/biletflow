import { z } from "zod";

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, "validation.organizerName").max(200, "validation.organizerNameMax"),
  contactEmail: z.string().trim().toLowerCase().pipe(z.email("validation.email")),
  contactPhone: z.string().trim().max(32, "validation.phoneMax").refine(
    (value) => !value || (/^\+?[0-9 ()-]+$/.test(value) && /^[0-9]{7,15}$/.test(value.replace(/\D/g, ""))),
    "validation.phone",
  ),
  description: z.string().trim().max(2000, "validation.descriptionMax"),
  payoutProvider: z.enum(["", "sandbox_bank", "sandbox_wallet"], { error: "validation.payoutProvider" }),
  payoutReference: z.string().trim().refine(
    (value) => !value || /^demo_[A-Za-z0-9_-]{3,64}$/.test(value),
    "validation.payoutReference",
  ),
}).superRefine((values, context) => {
  if (values.payoutReference && !values.payoutProvider) {
    context.addIssue({ code: "custom", path: ["payoutProvider"], message: "validation.payoutProvider" });
  }
  if (values.payoutProvider && !values.payoutReference) {
    context.addIssue({ code: "custom", path: ["payoutReference"], message: "validation.payoutRequired" });
  }
});

export type ProfileValues = z.infer<typeof profileSchema>;
