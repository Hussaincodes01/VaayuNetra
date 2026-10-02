import type { ReactNode } from "react";

// Email-safe building blocks: tables and inline styles only (no CSS classes, no web fonts required).
// Light body so clients that force light or dark mode keep the contrast; dark header band.

export const colors = {
  night: "#05070D",
  text: "#111827",
  muted: "#4B5563",
  rule: "#E5E7EB",
  link: "#0F766E",
  teal: "#2DD4BF",
  T1: "#DC2626",
  T2: "#A855F7",
  amberBg: "#FEF3C7",
  amberText: "#78350F",
};

const fontFor = (locale: string) =>
  locale === "hi"
    ? "'Noto Sans Devanagari', 'Nirmala UI', Mangal, Arial, sans-serif"
    : "Inter, 'Segoe UI', Arial, sans-serif";

export function Layout({
  locale,
  preview,
  brand,
  footer,
  children,
}: {
  locale: string;
  preview: string;
  brand: string;
  footer: string;
  children: ReactNode;
}) {
  const font = fontFor(locale);
  return (
    <html lang={locale}>
      <head>
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#F3F4F6" }}>
        {/* Inbox preview line; hidden in the body. */}
        <div
          style={{
            display: "none",
            overflow: "hidden",
            lineHeight: "1px",
            opacity: 0,
            maxHeight: 0,
            maxWidth: 0,
          }}
        >
          {preview}
        </div>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: "#F3F4F6", padding: "24px 12px" }}
        >
          <tbody>
            <tr>
              <td align="center">
                <table
                  role="presentation"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: 600,
                    backgroundColor: "#FFFFFF",
                    borderRadius: 8,
                    overflow: "hidden",
                    fontFamily: font,
                    color: colors.text,
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          backgroundColor: colors.night,
                          padding: "16px 24px",
                          color: "#E8ECF4",
                          fontSize: 18,
                          fontWeight: 700,
                          letterSpacing: locale === "hi" ? 0 : 0.5,
                        }}
                      >
                        <span style={{ color: colors.teal }}>●</span> {brand}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "24px 24px 8px" }}>{children}</td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          padding: "16px 24px 24px",
                          borderTop: `1px solid ${colors.rule}`,
                          fontSize: 12,
                          lineHeight: "18px",
                          color: colors.muted,
                        }}
                      >
                        {footer}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{
        margin: "0 0 12px",
        fontSize: 22,
        lineHeight: "30px",
        fontWeight: 700,
        color: colors.text,
      }}
    >
      {children}
    </h1>
  );
}

export function P({
  children,
  muted = false,
  small = false,
}: {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
}) {
  return (
    <p
      style={{
        margin: "0 0 14px",
        fontSize: small ? 13 : 15,
        lineHeight: small ? "20px" : "23px",
        color: muted ? colors.muted : colors.text,
      }}
    >
      {children}
    </p>
  );
}

/** Two-column facts table (label, value). */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: "4px 0 18px", borderCollapse: "collapse" }}
    >
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td
              style={{
                padding: "8px 12px 8px 0",
                borderBottom: `1px solid ${colors.rule}`,
                fontSize: 13,
                color: colors.muted,
                width: "40%",
                verticalAlign: "top",
              }}
            >
              {label}
            </td>
            <td
              style={{
                padding: "8px 0",
                borderBottom: `1px solid ${colors.rule}`,
                fontSize: 14,
                fontFamily:
                  "'JetBrains Mono', Consolas, 'Courier New', monospace",
                color: colors.text,
                verticalAlign: "top",
              }}
            >
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Button({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: "8px 0 18px" }}
    >
      <tbody>
        <tr>
          <td style={{ backgroundColor: colors.night, borderRadius: 6 }}>
            <a
              href={href}
              style={{
                display: "inline-block",
                padding: "11px 18px",
                color: "#FFFFFF",
                fontSize: 15,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** The screening-grade line, shown wherever a rate appears. */
export function Screening({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 18px",
        padding: "10px 12px",
        backgroundColor: colors.amberBg,
        color: colors.amberText,
        borderRadius: 6,
        fontSize: 13,
        lineHeight: "20px",
      }}
    >
      {children}
    </p>
  );
}

export function TierBadge({
  tier,
  label,
}: {
  tier: "T1" | "T2";
  label: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        backgroundColor: colors[tier],
        // White on T1 red, near-black on T2 purple: both above 4.5:1.
        color: tier === "T1" ? "#FFFFFF" : colors.night,
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}
