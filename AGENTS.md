# AGENTS.md

Tools for monitoring Bulgarian elections. Each top-level folder is its own project.

## Rules
- The repo is public. Never commit secrets, `.env` files, volunteer contacts or new username lists.
- A fix for a hole in a live site must not be pushed before it is deployed. Ask first.
- Never load-test or probe `evideo.bg` (third party, behind Cloudflare). It blocks the IP after about 10 quick requests. Use a local fake origin for tests.
- `elections-video-monitoring/` is a pnpm workspace. Never run `npm` in it: npm rewrites the stale `package-lock.json` files and breaks the pnpm `node_modules` layout. Use `pnpm install --frozen-lockfile`, `pnpm audit` and `pnpm outdated -r`. (`apps/coordinator/package-lock.json` stays: the server install runs `npm ci` with it.)
- UI changes follow [elections-video-monitoring/docs/mobile-ui.md](elections-video-monitoring/docs/mobile-ui.md). Above all, the on-screen keyboard must never cover a submit button.

## Live systems
- Volunteer site: `https://video.promeni.bg`. SSH to its server works only through a VPN tunnel; access details stay in the operators' private notes, never in the repo.
- `karta.izborenmonitor.com/video/metrics` is a separate live service that the volunteer page uses.
- `evideo.izborenmonitor.com` was a test site and is retired.
- The evideo election codes (`pe202604`, `le20261018`, …) differ from CIK codes (`pvr2026`). Take the code from the evideo.bg home page on the day.
