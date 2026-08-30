import { channelsRouter } from "./router/channels";
import { feedRouter } from "./router/feed";
import { interactionsRouter } from "./router/interactions";
import { onboardingRouter } from "./router/onboarding";
import { profileRouter } from "./router/profile";
import { createTRPCRouter, publicProcedure } from "./trpc";

export const appRouter = createTRPCRouter({
  health: createTRPCRouter({
    ping: publicProcedure.query(() => ({
      ok: true as const,
      service: "tiktok_gram" as const,
    })),
  }),
  onboarding: onboardingRouter,
  feed: feedRouter,
  channels: channelsRouter,
  interactions: interactionsRouter,
  profile: profileRouter,
});

export type AppRouter = typeof appRouter;
