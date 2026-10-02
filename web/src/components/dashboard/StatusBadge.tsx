import { useTranslations } from "next-intl";
import type { SiteStatus } from "@/lib/landing-types";
import { cn } from "@/lib/utils";
import { STATUS_COLOUR, STATUS_TEXT } from "./status";

export function StatusBadge({
  status,
  className,
}: {
  status: SiteStatus;
  className?: string;
}) {
  const t = useTranslations("Dash.status");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
      style={{ borderColor: STATUS_COLOUR[status], color: STATUS_TEXT[status] }}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: STATUS_COLOUR[status] }}
      />
      {t(status)}
    </span>
  );
}
