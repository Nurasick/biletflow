import { z } from "zod";

export const passwordSchema = z.string()
  .min(8, "Use at least 8 characters")
  .max(50, "Use no more than 50 characters");
