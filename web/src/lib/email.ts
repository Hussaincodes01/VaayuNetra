import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

// Two ways to send, picked by what is configured (SMTP first):
//   SMTP   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS. Free with a Gmail app password, no domain needed:
//          smtp.gmail.com, port 465, the Gmail address and a 16-character app password.
//   Resend RESEND_API_KEY, sending from a domain verified in Resend.
// ALERT_FROM_EMAIL is the sender either way (with Gmail it must be the Gmail address itself).
// RESEND_API_URL points elsewhere only for local tests (a capture server).
const RESEND_API_URL = (
  process.env.RESEND_API_URL || "https://api.resend.com"
).replace(/\/$/, "");

const smtpConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
);

export const emailTransport: "smtp" | "resend" | null = smtpConfigured
  ? "smtp"
  : process.env.RESEND_API_KEY
    ? "resend"
    : null;

export const emailConfigured = Boolean(
  emailTransport && process.env.ALERT_FROM_EMAIL,
);

export const EMAIL_NOT_CONFIGURED =
  "email is not configured: set ALERT_FROM_EMAIL and either SMTP_HOST/SMTP_USER/SMTP_PASS or RESEND_API_KEY";

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

let transporter: Transporter | null = null;
function smtp(): Transporter {
  const port = Number(process.env.SMTP_PORT || 465);
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

async function sendSmtp(mail: Mail, from: string): Promise<MailResult> {
  try {
    const info = await smtp().sendMail({
      from: { name: "VayuNetra", address: from },
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: mail.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        encoding: "base64",
      })),
    });
    return { ok: true, id: info.messageId ?? null };
  } catch (e) {
    return { ok: false, error: `SMTP: ${(e as Error).message}` };
  }
}

async function sendResend(
  mail: Mail,
  from: string,
  key: string,
): Promise<MailResult> {
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

/** Send one email through SMTP (preferred when configured) or Resend. */
export async function sendMail(mail: Mail): Promise<MailResult> {
  const from = process.env.ALERT_FROM_EMAIL;
  if (!from || !emailTransport)
    return { ok: false, error: EMAIL_NOT_CONFIGURED };
  return emailTransport === "smtp"
    ? sendSmtp(mail, from)
    : sendResend(mail, from, process.env.RESEND_API_KEY!);
}

/** Short form used by the dashboard (assignee notices). Returns false when not configured or on error. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  return (await sendMail({ to, subject, html })).ok;
}
