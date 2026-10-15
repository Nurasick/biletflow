import { z } from "zod";

export const passwordSchema = z.string()
  .min(8, "validation.passwordMin")
  .max(50, "validation.passwordMax");
