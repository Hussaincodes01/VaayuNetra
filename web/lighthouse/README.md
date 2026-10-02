# Lighthouse reports

Lighthouse 12.8.2, desktop preset, run on 2 October 2026 against a local production build
(`pnpm build && pnpm start`) reading the local Supabase stack seeded with the field-test data.
Open the `.report.html` files in a browser; the `.report.json` files hold the same data.

| Page | Performance | Accessibility | Best practices | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| `/` (English landing) | 98 | 100 | 100 | 100 | 1.0 s | 20 ms | 0 |
| `/hi` (Hindi landing) | 97 | 100 | 100 | 100 | 1.0 s | 20 ms | 0 |
| `/map` (public map) | 100 | 100 | 100 | 100 | 0.7 s | 10 ms | 0.001 |
| `/login` | 100 | 100 | 100 | 90 | 0.7 s | 20 ms | 0 |

Notes:

- `/login` loses SEO points on purpose: the sign-in page is marked `noindex`.
- No Mapbox token was set, so the maps used their built-in schematic fallback. With a token, the
  landing page loads the Mapbox globe after the first interaction or 6 seconds, whichever comes
  first, so these numbers do not include it.
- The pages were served with the production security headers (`next.config.ts`), including the
  Content Security Policy.

To regenerate (with the production server on port 3100):

```bash
npx lighthouse@12 http://localhost:3100/ --preset=desktop --output=html --output=json \
  --output-path=./lighthouse/landing-en
```
