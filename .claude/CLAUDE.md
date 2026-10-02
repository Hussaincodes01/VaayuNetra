# VayuNetra — project context (read before any task)

## What it is
VayuNetra ("eye on the air") is a satellite AI system that detects, verifies, quantifies and helps fix methane
plumes from Indian landfills. Free Sentinel-2 imagery → MBMP methane retrieval → fine-tuned U-Net → physics gate
→ emission rate (kg/h) with uncertainty → action dossier for government bodies (MoHUA, CPCB/SPCBs, municipal
corporations). Entry for the Net Zero AI Architecture hackathon. Team lead: Jiyad Hussain (Amity University, Noida).

## Repo layout
web/       Next.js 15 (App Router, TypeScript, Tailwind, shadcn/ui) — landing page + /dashboard, deployed on Vercel
worker/    Python 3.11 — VayuNetra inference worker (runs on the team's own GPU/CPU machine)
video/     Remotion — 5-minute solution film
supabase/  SQL migrations, RLS policies, seed script
data/seed/ CSV/GeoJSON/HTML exported from the ops notebook (scan_all_passes.csv, site_summary.csv,
           confirmed_events.csv, tasking_list.geojson, dossier_*.html, sensitivity.png)
notebooks/ training notebook + ops notebook (source of truth for the science)
models/    gitignored — vayunetra_best_model_*.zip (weights, model_card.json, LUT)

## Model (verified)
- U-Net, ResNet-50 encoder pretrained with SSL4EO-S12 (self-supervised on Sentinel-2), 17 input channels
  (13 Sentinel-2 L1C bands + reference SWIR1/SWIR2 + 2 MBMP channels), 33.9 M parameters.
- Trained on MethaneSET: 3,552 real Sentinel-2 plume samples + synthetic WRF-LES plumes injected into real scenes.
- Scene threshold 0.844 (model card). Wind calibration U_eff = 0.140·U10 + 1.111. IME emission method.

## Global benchmark — held-out test sites (VayuNetra vs classic MBMP method)
- ROC AUC 0.759 vs 0.513
- Recall at 5% / 10% / 20% false-alarm rate: 0.24 / 0.34 / 0.52 vs 0.10 / 0.15 / 0.24
- At the operating threshold: precision 0.779 vs 0.602, recall 0.303 vs 0.144, false-alarm rate 8.6% vs 9.6%
- Plume outline (pixel IoU) 0.312 vs 0.077
- Recall by emission rate: 3–5 t/h 0.35 vs 0.10 · 5–10 t/h 0.34 vs 0.10 · >10 t/h 0.37 vs 0.06 · <1 t/h 0.09 vs 0.27
- Emission rate within ±50% of the published MARS rate for 58% of 839 real plumes; median ratio 1.02 (unbiased)

## India field test — Jan 2024 to Dec 2025
- Sites: Ghazipur, Bhalswa, Okhla (Delhi) · Deonar (Mumbai) · Pirana (Ahmedabad) + one control point 5 km from each.
- 674 clear Sentinel-2 scenes (340 landfill, 334 control). Control false alarms: 0 of 334.
- 14 landfill flags vs 0 at controls (p < 0.001). At the India-calibrated threshold 0.793: 31/340 vs 4/334 (p ≈ 1e-6).
- Physics gate: T1 methane-confident = 1 · T2 probable = 2 · T3 surface change = 11 (2 burn-like at Ghazipur).
  - T1 Deonar, 6 Jan 2025: ≈ 20.2 t/h (68% range 15.1–25.0), wind 5.1 m/s. Unconfirmed: queued for hyperspectral check.
  - T2 Bhalswa, 18 May 2025: ≈ 19.1 t/h · T2 Okhla, 29 Nov 2024: rate not estimated (calm wind 0.7 m/s).
- Persistent-emission upper bounds (95%): Ghazipur ≤ 5, Bhalswa ≤ 5, Deonar ≤ 10, Pirana ≤ 10, Okhla ≤ 20 t/h.
- Per-pass detection over dense Indian landfills ≈ 25–35% for plumes ≥ 10 t/h; known-truth test: estimated rate
  0.98× the injected rate at 10 t/h.
- Deonar minimum time-averaged rate 301 kg/h ≈ 71,000 t CO₂e/yr (GWP100 = 27). Action plan at 60% gas capture:
  ≈ 41,900 t CO₂e/yr avoided, ≈ 0.9 MW electric (assumption-based, editable).
- Fine-tuning on Indian backgrounds did not improve held-out detection (AUC ≈ 0.55): the limit is the Sentinel-2
  signal against dense urban backgrounds, which is why VayuNetra is a two-tier system.

## Context facts (cite when shown)
- Methane warms ~80× more than CO₂ over 20 years (IPCC AR6: GWP20 79.7, GWP100 27.0 for non-fossil CH₄).
- Maasakkers et al. 2022, Science Advances: landfill emissions in Delhi, Mumbai, Lahore and Buenos Aires were
  1.4–2.6× higher than earlier estimates.
- Ghazipur landfill fire, April 2024 (CNN). Sentinel-2 is free and revisits every ~5 days.
- India's net-zero target: 2070. Swachh Bharat Mission-Urban 2.0 targets legacy dumpsite remediation.

## Wording rules (non-negotiable)
- Use only numbers in this file. Never invent statistics, partners, users, awards or deployments.
- Tiers: T1 = methane-confident, T2 = probable (needs confirmation), T3 = surface change (rejected as methane).
  Never call T2 or T3 a "detection of methane".
- Every satellite estimate is screening-grade and must be confirmed (hyperspectral satellite, OGI drone or ground
  survey) before enforcement or carbon crediting. Show this line wherever rates appear.
- Say "minimum estimate" for annual figures. Show assumptions next to money figures.
- Never claim "first", "only" or "real-time". Sentinel-2 revisits every ~5 days; say "every new pass".

## Design system
- Mood: daylight above the clouds: a green Earth seen from the sky, calm, scientific, government-credible.
  Light only. No dark theme, dark panels or dark overlays anywhere (site, dashboard, emails, PDFs, share image).
- Colours: page #F6F8F3 · surfaces #FFFFFF · headings #0E3B2A (canopy) · body #15301F / muted #4A6355
  · leaf green #1E7B45 (actions, links, focus) · sprout #CDEFC0 (highlight fills only) · sky #DCECF1 (hero sky)
  · methane ramp #FDE68A → #F59E0B → #DC2626 (plumes only) · T1 #DC2626, T2 #A855F7, T3 #F59E0B, clear #22C55E
  for fills and markers; as text on light grounds use T1 #B91C1C, T2 #7E22CE, T3 #B45309, clear #15803D.
- Hero: a stylised daylight 3D Earth (NASA Blue Marble, baked green) turned to India with the five landfills
  pinned in status colours, rising out of a cloud bank. Posters in web/public/hero/ match its first frame.
- Charts: VayuNetra #1E7B45 vs classic MBMP #4A86CF (validated pair); faint #0E3B2A gridlines.
- Labels in sentence case; no tracked all-caps eyebrows.
- Type: Space Grotesk (headings), Inter (body), JetBrains Mono (numbers, coordinates).
- Motion: slow, cinematic, purposeful (GSAP + Lenis). Respect prefers-reduced-motion. 60 fps target.
- Bilingual: English default, Hindi toggle for all dashboard labels and alerts.
- Accessibility: WCAG 2.2 AA contrast, keyboard navigation, alt text on every evidence image.