import { Button, Facts, H1, Layout, P, Screening, TierBadge } from "./Layout";

export type EventAlertProps = {
  locale: string;
  brand: string;
  footer: string;
  preview: string;
  heading: string;
  tier: "T1" | "T2";
  tierLabel: string;
  intro: string;
  meaning: string;
  facts: [string, string][];
  evidence: { src: string; alt: string; caption: string } | null;
  noEvidence: string;
  screening: string;
  cta: string;
  href: string;
  next: string;
  why: string;
};

/** New T1/T2 event at a landfill, sent to the state's alert recipients. */
export function EventAlert(p: EventAlertProps) {
  return (
    <Layout
      locale={p.locale}
      preview={p.preview}
      brand={p.brand}
      footer={p.footer}
    >
      <p style={{ margin: "0 0 10px" }}>
        <TierBadge tier={p.tier} label={p.tierLabel} />
      </p>
      <H1>{p.heading}</H1>
      <P>{p.intro}</P>
      <P muted small>
        {p.meaning}
      </P>
      <Facts rows={p.facts} />
      <Screening>{p.screening}</Screening>
      {p.evidence ? (
        <div style={{ margin: "0 0 18px" }}>
          <img
            src={p.evidence.src}
            alt={p.evidence.alt}
            width={552}
            style={{
              display: "block",
              width: "100%",
              maxWidth: 552,
              height: "auto",
              borderRadius: 6,
              border: "1px solid #E5E7EB",
            }}
          />
          <div style={{ marginTop: 6 }}>
            <P muted small>
              {p.evidence.caption}
            </P>
          </div>
        </div>
      ) : (
        <P muted small>
          {p.noEvidence}
        </P>
      )}
      <Button href={p.href}>{p.cta}</Button>
      <P small>{p.next}</P>
      <P muted small>
        {p.why}
      </P>
    </Layout>
  );
}
