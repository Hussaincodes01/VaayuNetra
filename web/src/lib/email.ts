import "server-only";

// Resend REST API. RESEND_API_URL points elsewhere only for local tests (a capture server).
const RESEND_API_URL = (
  process.env.RESEND_API_URL || "https://api.resend.com"
).replace(/\/$/, "");

export const emailConfigured = Boolean(
  process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL,
);

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** PDF or other files, base64-encoded. */
  attachments?: { filename: string; content: string }[];
  /** Resend drops a repeat of the same key within 24 h, so a retried request cannot send twice. */
  idempotencyKey?: string;
};

export type MailResult =
  { ok: true; id: string | null } | { ok: false; error: string };

/** Send one email through Resend (RESEND_API_KEY, ALERT_FROM_EMAIL). */
export async function sendMail(mail: Mail): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;
  if (!key || !from)
    return {
      ok: false,
      error: "RESEND_API_KEY or ALERT_FROM_EMAIL is not set",
    };
  try {
    const res = await fetch(`${RESEND_API_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(mail.idempotencyKey
          ? { "Idempotency-Key": mail.idempotencyKey.slice(0, 256) }
          : {}),
      },
      body: JSON.stringify({
        from: `VayuNetra <${from}>`,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        attachments: mail.attachments,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => null)) as {
      id?: string;
      message?: string;
    } | null;
    if (!res.ok)
      return {
        ok: false,
        error: `Resend ${res.status}: ${body?.message ?? res.statusText}`,
      };
    return { ok: true, id: body?.id ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Short form used by the dashboard (assignee notices). Returns false when not configured or on error. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  return (await sendMail({ to, subject, html })).ok;
}
