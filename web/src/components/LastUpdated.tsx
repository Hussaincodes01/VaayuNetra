import { useLocale, useTranslations } from "next-intl";
import { makeFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Last updated <date>": when the newest scan reached the database (works in server and client components). */
export function LastUpdated({
  at,
  className,
}: {
  at: string | null;
  className?: string;
}) {
  const t = useTranslations("Common");
  const f = makeFormat(useLocale());
  return (
    <p
      data-testid="last-updated"
      className={cn("text-xs text-muted-foreground", className)}
    >
      {at ? t("lastUpdated", { when: f.dateTime(at) }) : t("lastUpdatedNone")}
    </p>
  );
}
