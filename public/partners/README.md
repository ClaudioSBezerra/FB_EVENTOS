# Partners assets

Logos and branding of strategic partners. Used in the login page split-screen
(2026-06-17). Update via PR — assets are checked into git for predictable
deploys (Coolify build context).

## Files

| File | Used by | Notes |
|------|---------|-------|
| `gru-logo.png` | `src/app/(auth)/login/page.tsx` | GRU — cofundadora. White-on-dark recommended (the login painel is `bg-slate-900`). PNG with transparent bg ~512×256, or SVG. |

## Adding a new partner asset

1. Drop the file in this folder.
2. Reference via `<Image src="/partners/<filename>" .../>` (Next.js serves `/public/*` from root).
3. Commit + push — Coolify rebuilds and the asset ships with the image.
