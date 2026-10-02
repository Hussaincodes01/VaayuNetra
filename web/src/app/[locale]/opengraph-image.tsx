import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export const alt =
  "VayuNetra plume mask over Deonar landfill, Mumbai, 6 January 2025";

// English copy in both locales: the OG renderer's built-in font has no Devanagari glyphs.
export default async function OpenGraphImage() {
  const mask = await readFile(
    join(process.cwd(), "public", "og", "t1-mask.png"),
  );
  const src = `data:image/png;base64,${mask.toString("base64")}`;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#05070D",
        color: "#E8ECF4",
        padding: 64,
        gap: 56,
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ fontSize: 28, color: "#2DD4BF", letterSpacing: 4 }}>
          VAYUNETRA
        </div>
        <div
          style={{
            fontSize: 62,
            fontWeight: 700,
            lineHeight: 1.08,
            marginTop: 24,
          }}
        >
          Methane is invisible. VayuNetra makes it visible.
        </div>
        <div style={{ fontSize: 26, color: "#8A93A6", marginTop: 28 }}>
          Satellite methane screening for Indian landfills · Deonar, Mumbai, 6
          January 2025
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        width={420}
        height={420}
        alt=""
        style={{ borderRadius: 20, border: "2px solid #F59E0B" }}
      />
    </div>,
    size,
  );
}
