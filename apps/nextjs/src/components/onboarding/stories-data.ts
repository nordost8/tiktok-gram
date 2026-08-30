/**
 * Onboarding story deck data. `title`/`description`/`cta` are i18n KEY
 * STRINGS (see `onboarding.stories.*` in lib/i18n/messages/*.json), not
 * display text — this module is plain data with no React/i18next
 * dependency. Callers translate with `t(key)` (see OnboardingStories.tsx).
 */
export const ONBOARDING_STORIES = [
  {
    title: "onboarding.stories.introFeed.title",
    description: "onboarding.stories.introFeed.description",
    cta: "onboarding.stories.introFeed.cta",
    art: "intro-feed",
    icon: "🎬",
  },
  {
    title: "onboarding.stories.introSwipe.title",
    description: "onboarding.stories.introSwipe.description",
    cta: "onboarding.stories.introSwipe.cta",
    art: "intro-swipe",
    icon: "👆",
  },
  {
    title: "onboarding.stories.introMix.title",
    description: "onboarding.stories.introMix.description",
    cta: "onboarding.stories.introMix.cta",
    art: "intro-mix",
    icon: "🌟",
  },
  {
    title: "onboarding.stories.introTarget.title",
    description: "onboarding.stories.introTarget.description",
    cta: "onboarding.stories.introTarget.cta",
    art: "intro-target",
    icon: "🎯",
  },
] as const;
