import { type Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Login",
  });
  return { title: t("title"), robots: { index: false } };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; invited?: string; error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const { next, invited, error } = await searchParams;
  const t = await getTranslations("Login");
  return (
    <main
      id="main"
      className="flex min-h-dvh items-center justify-center bg-background px-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <Link href="/" className="font-heading text-lg font-semibold">
          Vayu<span className="text-signal">Netra</span>
        </Link>
        <h1 className="mt-6 font-heading text-2xl font-semibold">
          {t("title")}
        </h1>
        <p className="mt-2 text-sm text-foreground/75">{t("text")}</p>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-tier-1/40 bg-tier-1/10 p-3 text-sm"
          >
            {t("linkExpired")}
          </p>
        )}
        <LoginForm next={next ?? "/dashboard"} />
        {invited === "1" && (
          <p className="mt-4 text-xs text-muted-foreground">
            {t("invitedHint")}
          </p>
        )}
        <div className="mt-6 flex justify-between text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            {t("back")}
          </Link>
          <Link href="/#request" className="hover:text-foreground">
            {t("requestAccess")}
          </Link>
        </div>
      </div>
    </main>
  );
}
