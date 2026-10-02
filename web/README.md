# VayuNetra web

Next.js 15 (App Router) site and dashboard. English is served at `/`, Hindi at `/hi`
(next-intl; strings live in `messages/`).

```bash
pnpm install
cp .env.example .env.local   # fill in values
pnpm dev                     # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm build
```

Deployed on Vercel with the project root set to `web/`. See the root README for the full system.
