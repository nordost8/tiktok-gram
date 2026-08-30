import type { Locale } from "./index";

/**
 * Interest-category title/description come from Postgres
 * (`telegram_interest_categories`, seeded English in
 * packages/db/seed/telegram-feed.ts), so they can't go through the normal
 * `t()` catalog — a translation key needs static content, not a database
 * row. This is the one exception: a client-side override table, keyed by the
 * category's stable `slug`, applied only for locales other than the DB's
 * canonical language (English). Falls back to the DB value when a slug has
 * no override (e.g. a category added after this table was last updated).
 *
 * Channel titles are NOT translated this way — those are real Telegram
 * channel names, not UI copy.
 */
const UK_CATEGORY_OVERRIDES: Record<string, { title: string; description: string }> = {
  "it-tech": { title: "IT і технології", description: "Хабр, AI, програмування, стартапи, крипта" },
  "business-finance": { title: "Бізнес і фінанси", description: "Бізнес-новини, інвестиції, нерухомість" },
  creativity: { title: "Творчість", description: "Кіно, музика, мистецтво, фотографія" },
  lifestyle: { title: "Лайфстайл", description: "Мода, їжа, подорожі, авто, стиль життя" },
  psychology: { title: "Психологія і розвиток", description: "Мотивація, стосунки, батьківство, саморозвиток" },
  "sport-games": { title: "Спорт і ігри", description: "Спорт, кіберспорт, фітнес, здоровʼя" },
  "science-edu": { title: "Наука і освіта", description: "Наукпоп, освіта, курси" },
  "humor-memes": { title: "Гумор і меми", description: "Жарти, меми, тренд-комедія" },
  news: { title: "Новини", description: "Головне за день, політика, суспільство" },
  "war-osint": { title: "Війна та OSINT", description: "Фронт, аналітика, розслідування, безпека" },
  local: { title: "Локальне", description: "Міста, події, локальні новини" },
  video: { title: "Відео", description: "Короткі відео, нарізки, кліпи" },
  gaming: { title: "Ігрові", description: "Ігри, кіберспорт, стриминг" },
  entertainment: { title: "Шоубіз", description: "Зірки, серіали, шоу-бізнес" },
  culinary: { title: "Кулінаріті", description: "Рецепти, страви, кулінарні поради" },
  "auto-moto": { title: "Авто / мото", description: "Автомобілі, мотоцикли, тест-драйви" },
  medicine: { title: "Медицина", description: "Здоров'я, медичні поради, новини медицини" },
  sports: { title: "Спорт", description: "Футбол, Формула 1, спортивні новини" },
  nostalgia: { title: "Ностальгія", description: "Спогади, ретро, минуле" },
  fashion: { title: "Мода", description: "Стиль, одяг, тренди" },
  design: { title: "Дизайн", description: "Графічний дизайн, UI/UX, творчі роботи" },
};

export interface CategoryLike {
  slug: string;
  title: string;
  /** Some callers (e.g. the channel-filter chip list) don't select this column at all. */
  description?: string | null;
}

/** Applies the locale override for a category, falling back to the DB value. */
export function localizeCategory<T extends CategoryLike>(locale: Locale, category: T): T {
  if (locale !== "uk") return category;
  const override = UK_CATEGORY_OVERRIDES[category.slug];
  if (!override) return category;
  return {
    ...category,
    title: override.title,
    ...("description" in category ? { description: override.description } : {}),
  };
}
