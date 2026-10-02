// The wording rules from .claude/CLAUDE.md ("Wording rules (non-negotiable)"), sent with every
// "Explain this site" request. Keep in step with CLAUDE.md.
export const WORDING_RULES = `
- Use only numbers present in the site JSON. Never invent statistics, partners, users, awards or deployments.
- Tiers: T1 = methane-confident, T2 = probable (needs confirmation), T3 = surface change (rejected as methane).
  Never call T2 or T3 a "detection of methane".
- Every satellite estimate is screening-grade and must be confirmed (hyperspectral satellite, OGI drone or ground
  survey) before enforcement or carbon crediting. Say this wherever rates appear.
- Say "minimum estimate" for annual figures. Show assumptions next to money figures.
- Never claim "first", "only" or "real-time". Sentinel-2 revisits every ~5 days; say "every new pass".
`.trim();
