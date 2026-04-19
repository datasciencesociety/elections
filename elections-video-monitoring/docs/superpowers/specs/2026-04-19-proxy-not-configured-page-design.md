# Design: Proxy-not-configured volunteer page

## Problem

When `PROXY_URL` is not set, `server.js` returns a bare plaintext 500 response. Volunteers who land on `/` see a broken page with no guidance.

## Goal

Replace that error with a friendly, styled HTML page that tells volunteers the system isn't ready yet and points them to the help page.

## Approach

**Separate static file (`public/not-ready.html`)** served by the existing `serveFile()` helper. Keeps the response self-contained and consistent with how all other HTML pages are served.

## Page design

- Matches `volunteer.html` styling: same CSS custom properties, dark/light mode, system-ui font
- Header: app title, same visual weight as the rest of the app
- Centered card with a clock/warning icon
- Two-language message (BG primary, EN secondary):
  - BG: "Системата все още не е готова. Моля, свържете се с координатора си."
  - EN: "The system is not ready yet. Please contact your coordinator."
- "Help" link button pointing to `/help`
- No technical detail, no error codes visible to the volunteer

## Server changes

In `server.js`, replace the two raw `res.end('Server misconfiguration…')` calls (at the `GET /` and `GET /inspect/` handlers) with:

```js
serveFile(res, path.join(__dirname, 'public', 'not-ready.html'), 'text/html; charset=utf-8');
```

Keep the `500` status code (set it before calling `serveFile`, or update `serveFile` call to pass status — needs a small adjustment since current `serveFile` hardcodes 200).

## Files changed

| File | Change |
|------|--------|
| `apps/coordinator/public/not-ready.html` | New file |
| `apps/coordinator/server.js` | Replace 2 plaintext 500 responses with `serveFile` of new page |
