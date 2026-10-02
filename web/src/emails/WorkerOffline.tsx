import { Button, colors, H1, Layout, P } from "./Layout";

export type WorkerOfflineProps = {
  locale: string;
  brand: string;
  footer: string;
  preview: string;
  heading: string;
  body: string;
  fix: string;
  commands: string[];
  cta: string;
  href: string;
  why: string;
};

/** The inference worker has not sent a heartbeat for over two hours. Sent once per outage to admins. */
export function WorkerOffline(p: WorkerOfflineProps) {
  return (
    <Layout
      locale={p.locale}
      preview={p.preview}
      brand={p.brand}
      footer={p.footer}
    >
      <H1>{p.heading}</H1>
      <P>{p.body}</P>
      <P>{p.fix}</P>
      <pre
        style={{
          margin: "0 0 18px",
          padding: "10px 12px",
          backgroundColor: "#F3F4F6",
          border: `1px solid ${colors.rule}`,
          borderRadius: 6,
          fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
          fontSize: 13,
          lineHeight: "20px",
          whiteSpace: "pre-wrap",
          color: colors.text,
        }}
      >
        {p.commands.join("\n")}
      </pre>
      <Button href={p.href}>{p.cta}</Button>
      <P muted small>
        {p.why}
      </P>
    </Layout>
  );
}
