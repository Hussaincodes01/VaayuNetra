/**
 * Public base URL for links in emails, magic-link redirects and metadata.
 * Production sets NEXT_PUBLIC_SITE_URL (the custom domain or vayunetra-india.vercel.app). Preview deployments
 * leave it unset and use their own branch URL, which Vercel exposes as NEXT_PUBLIC_VERCEL_BRANCH_URL.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL &&
    `https://${process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL}`) ||
  (process.env.NEXT_PUBLIC_VERCEL_URL &&
    `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`) ||
  "http://localhost:3000"
).replace(/\/$/, "");
