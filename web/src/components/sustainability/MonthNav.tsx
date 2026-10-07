import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

/** Previous / next month links for a page that takes ?month=YYYY-MM. */
export function MonthNav({ path, month }: { path: string; month: string }) {
  const t = useTranslations("Scorecard");
  const locale = useLocale();
  const current = new Date().toISOString().slice(0, 7);
  const label = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
  const next = shift(month, 1);
  return (
    <nav aria-label={t("monthNav")} className="flex items-center gap-3 text-sm">
      <Link
        href={`${path}?month=${shift(month, -1)}`}
        className="text-leaf hover:underline"
      >
        ← {t("previous")}
      </Link>
      <span className="font-medium" aria-current="page">
        {label}
      </span>
      {next <= current && (
        <Link
          href={`${path}?month=${next}`}
          className="text-leaf hover:underline"
        >
          {t("next")} →
        </Link>
      )}
    </nav>
  );
}
