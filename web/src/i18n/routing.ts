import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "hi"],
  defaultLocale: "en",
  // English lives at "/", Hindi at "/hi".
  localePrefix: "as-needed",
});
