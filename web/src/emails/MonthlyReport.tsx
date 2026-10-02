import { Button, colors, Facts, H1, Layout, P, Screening } from "./Layout";

export type MonthlyReportEmailProps = {
  locale: string;
  brand: string;
  footer: string;
  preview: string;
  heading: string;
  intro: string;
  facts: [string, string][];
  co2Note: string;
  eventsTitle: string;
  events: string[];
  noEvents: string;
  screening: string;
  cta: string;
  href: string;
  why: string;
};

/** Monthly per-state summary; the PDF report travels as an attachment. */
export function MonthlyReportEmail(p: MonthlyReportEmailProps) {
  return (
    <Layout
      locale={p.locale}
      preview={p.preview}
      brand={p.brand}
      footer={p.footer}
    >
      <H1>{p.heading}</H1>
      <P>{p.intro}</P>
      <Facts rows={p.facts} />
      <P muted small>
        {p.co2Note}
      </P>
      <h2 style={{ margin: "8px 0 8px", fontSize: 16, color: colors.text }}>
        {p.eventsTitle}
      </h2>
      {p.events.length === 0 ? (
        <P muted small>
          {p.noEvents}
        </P>
      ) : (
        <ul
          style={{
            margin: "0 0 16px",
            paddingLeft: 20,
            fontSize: 14,
            lineHeight: "22px",
          }}
        >
          {p.events.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <Screening>{p.screening}</Screening>
      <Button href={p.href}>{p.cta}</Button>
      <P muted small>
        {p.why}
      </P>
    </Layout>
  );
}
