# AGENTS.md

Tools for monitoring Bulgarian elections. Each top-level folder is its own project.

## Rules
- The repo is public. Never commit secrets, `.env` files, volunteer contacts or new username lists.
- A fix for a hole in a live site must not be pushed before it is deployed. Ask first.
- Never load-test or probe `evideo.bg` (third party, behind Cloudflare). It blocks the IP after about 10 quick requests. Use a local fake origin for tests.
- UI changes follow [elections-video-monitoring/docs/mobile-ui.md](elections-video-monitoring/docs/mobile-ui.md). Above all, the on-screen keyboard must never cover a submit button.

## Live systems
- Volunteer site: `https://video.promeni.bg`, on the `stork` server. SSH works only through the WireGuard tunnel `stork`.
- `karta.izborenmonitor.com/video/metrics` is a separate live service that the volunteer page uses.
- `evideo.izborenmonitor.com` was a test site and is retired.
- The evideo election codes (`pe202604`, `le20261018`, …) differ from CIK codes (`pvr2026`). Take the code from the evideo.bg home page on the day.
