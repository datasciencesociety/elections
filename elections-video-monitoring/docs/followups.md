# Follow-ups for V3

Collected on election night, 25 Oct 2026. Highest value first.

## Push to refresh

Volunteers keep the page open for hours, so a page-only deploy (`volunteer.html`, `i18n.js`) reaches them only when they reload. On 25 Oct the team had to ask everyone in chat.

- The server reports the release it serves, for example the git commit read at startup, in every heartbeat response.
- The page remembers the release it loaded with. When a heartbeat reports a different one, it shows a banner ("Има нова версия – презареди") or reloads by itself when no inspect panel is open.
- A reload must keep the cards: the session id is in `localStorage`, so the page resumes the same session.
- Test: e2e that changes the reported release and checks the banner and the resumed cards.

## Distribution

- Reshuffle by risk: volunteers who logged in before the high-risk sections were loaded keep lower-risk cards, because cards are never taken away. Offer them a swap ("по-рисковa секция без наблюдател") instead of removing anything.
- Load every priority section as a stub before volunteers log in, not after: the login fill can only give sections the coordinator already knows.
- Backup cover (`AUTOFILL_AFTER`) is built and tested but was not switched on. Decide whether to use it next time.

## Operations

- nginx: the video proxy should limit per volunteer, not per server. Pass the real client address to it and raise the rate to match a volunteer with 3–4 cards.
- Plan the server reboot for the pending kernel and libc updates outside election days.
- Remove the test accounts and test streams created on 25 Oct.
- Admin page: the flagged list keeps polling after the login expires and fills the console with 401 errors.
