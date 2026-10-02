import "server-only";

// Optional WhatsApp / SMS alerts through Twilio, off unless ALERTS_TWILIO_ENABLED=true and the three
// TWILIO_* values are set. TWILIO_FROM "whatsapp:+14155238886" sends WhatsApp, "+1…" sends SMS.
const TWILIO_API_URL = (
  process.env.TWILIO_API_URL || "https://api.twilio.com"
).replace(/\/$/, "");

export function twilioChannel(): "sms" | "whatsapp" | null {
  const {
    ALERTS_TWILIO_ENABLED,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM,
  } = process.env;
  if (ALERTS_TWILIO_ENABLED !== "true") return null;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) return null;
  return TWILIO_FROM.startsWith("whatsapp:") ? "whatsapp" : "sms";
}

/** Send one message; `to` is an E.164 number ("+9198…"). */
export async function sendTwilio(
  to: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const channel = twilioChannel();
  if (!channel) return { ok: false, error: "Twilio alerts are disabled" };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString(
    "base64",
  );
  const params = new URLSearchParams({
    From: process.env.TWILIO_FROM!,
    To: channel === "whatsapp" ? `whatsapp:${to}` : to,
    Body: body,
  });
  try {
    const res = await fetch(
      `${TWILIO_API_URL}/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (res.ok) return { ok: true };
    const err = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    return {
      ok: false,
      error: `Twilio ${res.status}: ${err?.message ?? res.statusText}`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
