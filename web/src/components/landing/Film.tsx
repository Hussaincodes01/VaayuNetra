"use client";

import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { FILM_CHAPTERS } from "@/content/film";
import { Kicker, SectionTitle } from "./ui";

type Source =
  | { kind: "youtube"; id: string }
  | { kind: "vimeo"; id: string }
  | { kind: "file"; url: string };

function parse(url: string): Source {
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/,
  );
  if (yt) return { kind: "youtube", id: yt[1] };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: "vimeo", id: vm[1] };
  return { kind: "file", url };
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The 5-minute film with chapter markers. Rendered only when NEXT_PUBLIC_VIDEO_URL is set. */
export function Film({ url }: { url: string }) {
  const t = useTranslations("Film");
  const source = useMemo(() => parse(url), [url]);
  const video = useRef<HTMLVideoElement>(null);
  const [start, setStart] = useState<number | null>(null);

  const embed =
    source.kind === "youtube"
      ? `https://www.youtube-nocookie.com/embed/${source.id}?rel=0&modestbranding=1${start !== null ? `&start=${start}&autoplay=1` : ""}`
      : source.kind === "vimeo"
        ? `https://player.vimeo.com/video/${source.id}?dnt=1${start !== null ? `&autoplay=1#t=${start}s` : ""}`
        : null;

  const seek = (s: number) => {
    if (source.kind === "file" && video.current) {
      video.current.currentTime = s;
      void video.current.play().catch(() => undefined);
    } else {
      setStart(s);
    }
  };

  return (
    <section
      id="film"
      aria-labelledby="film-title"
      className="relative z-10 bg-background py-28 md:py-36"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle id="film-title" className="mt-4">
          {t("title")}
        </SectionTitle>
        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_280px]">
          <div className="aspect-video overflow-hidden rounded-2xl border border-border bg-muted">
            {embed ? (
              <iframe
                key={embed}
                src={embed}
                title={t("playerTitle")}
                className="size-full"
                loading="lazy"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video
                ref={video}
                src={url}
                controls
                preload="metadata"
                className="size-full"
                aria-label={t("playerTitle")}
              />
            )}
          </div>
          <nav aria-label={t("chapters")}>
            <h3 className="font-heading font-semibold">{t("chapters")}</h3>
            <ol className="mt-4 space-y-1">
              {FILM_CHAPTERS.map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => seek(c.start)}
                    className="flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span className="w-10 font-mono text-xs text-signal">
                      {mmss(c.start)}
                    </span>
                    <span>{t(`chapter.${c.key}`)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </div>
    </section>
  );
}
