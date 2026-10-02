# Lighthouse reports

Lighthouse 12.8.2, desktop preset, run on 2 October 2026 against a local production build
(`pnpm build && pnpm start`) reading the local Supabase stack seeded with the field-test data.
Open the `.report.html` files in a browser; the `.report.json` files hold the same data.

| Page | Performance | Accessibility | Best practices | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| `/` (English landing) | 97 | 100 | 100 | 100 | 1.1 s | 10 ms | 0 |
| `/hi` (Hindi landing) | 96 | 100 | 100 | 100 | 1.2 s | 0 ms | 0 |
| `/map` (public map) | 99 | 100 | 100 | 100 | 0.8 s | 0 ms | 0.001 |
| `/login` | 100 | 100 | 100 | 90 | 0.6 s | 0 ms | 0 |

Notes:

- `/login` loses SEO points on purpose: the sign-in page is marked `noindex`.
- Light theme with the 3D Earth hero. Until the first interaction (or 6 seconds) the hero shows a
  100 KB poster of the Earth; three.js and the 247 KB Earth texture load after that, so these numbers
  do not include them. No Mapbox token was set, so the maps used their schematic fallback.
- The pages were served with the production security headers (`next.config.ts`), including the
  Content Security Policy.

To regenerate (with the production server on port 3100):

```bash
npx lighthouse@12 http://localhost:3100/ --preset=desktop --output=html --output=json \
  --output-path=./lighthouse/landing-en
```
