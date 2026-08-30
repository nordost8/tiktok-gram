import { z } from "zod/v4";

export const saveInterestsInputSchema = z.object({
  interestIds: z.array(z.string().uuid()).min(3),
});

export const interestDtoSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  emoji: z.string(),
});

export const onboardingStatusSchema = z.object({
  onboardingCompleted: z.boolean(),
  selectedInterests: z.array(interestDtoSchema),
  availableInterests: z.array(interestDtoSchema),
});
