# i18n Plan

## Tasks

- [ ] Create `apps/coordinator/public/i18n.js`
  - `TRANSLATIONS` object with `en` and `bg` keys for all strings
  - `t(key)` — returns translation for current language
  - `tf(key, vars)` — like `t()` but replaces `{n}`, `{m}` placeholders
  - `setLang(lang)` — saves to localStorage, calls `applyTranslations()`
  - `applyTranslations()` — walks `[data-i18n]`, `[data-i18n-placeholder]` elements
  - Default language: `bg` (falls back to localStorage value)

- [ ] Update `apps/coordinator/public/volunteer.html`
  - Add `<script src="i18n.js"></script>` in `<head>`
  - Add language toggle button to `<header>`
  - Add `data-i18n` attrs to: page title, header h1, session label, streams label, loading msg, inspect placeholder, overlay title, overlay body, start button
  - Replace JS strings with `t()` / `tf()` calls: status labels (initializing/loading/ok/covered/frozen/dark/error), session prefix (Resumed/Session), monitoring count, connect failed msg, reconnecting msg, last report label

- [ ] Update `apps/coordinator/public/admin.html`
  - Add `<script src="i18n.js"></script>` in `<head>`
  - Add language toggle button to `<header>`
  - Add `data-i18n` attrs to: page title, header h1, meta bar labels, section headings, table headers, no-flags message, upload textarea placeholder, filter placeholder
  - Replace JS strings with `t()` / `tf()` calls: upload feedback messages, confirm dialog text, toggle button labels (Enable/Disable), refresh status text, connection error text, relative time strings (s/m/h ago)

- [ ] `apps/coordinator/server.js` — no change needed
  - Existing `url.endsWith('.js')` handler already serves `public/i18n.js`

---

## Appendix: All Translations

### volunteer.html

| Key | English | Bulgarian |
|-----|---------|-----------|
| `header.title` | Election Stream Monitor | Монитор на изборни потоци |
| `session.connecting` | connecting… | свързване… |
| `streams.label` | Streams: | Потоци: |
| `loading.connecting` | Connecting to coordinator… | Свързване с координатора… |
| `inspect.placeholder` | ← select a stream to inspect | ← изберете поток за преглед |
| `overlay.title` | Stream Monitor | Монитор на потоци |
| `overlay.body` | Your browser needs to autoplay muted video streams. Click Start to begin monitoring. | Браузърът ви трябва да пусне автоматично потоците без звук. Натиснете Старт, за да започнете наблюдението. |
| `overlay.start` | Start Monitoring | Стартирай наблюдение |
| `status.initializing` | Initializing | Инициализиране |
| `status.loading` | Loading | Зареждане |
| `status.ok` | OK | OK |
| `status.covered` | COVERED | ПОКРИТ |
| `status.frozen` | FROZEN | ЗАМРАЗЕН |
| `status.dark` | DARK / MISSING | ТЪМЕН / ЛИПСВАЩ |
| `status.error` | Error | Грешка |
| `session.resumed` | Resumed | Възобновена |
| `session.new` | Session | Сесия |
| `monitoring.count` | Monitoring {n} streams | Наблюдават се {n} потока |
| `connect.failed` | Failed to connect. Retrying in 10s… | Неуспешна връзка. Повторен опит след 10s… |
| `reconnecting` | Reconnecting… | Повторно свързване… |
| `last.report` | Last report: | Последен доклад: |

### admin.html

| Key | English | Bulgarian |
|-----|---------|-----------|
| `admin.page.title` | Election Monitor — Admin | Изборен монитор — Администратор |
| `admin.header` | Election Stream Monitor — Admin | Монитор на изборни потоци — Администратор |
| `meta.volunteers` | Active volunteers: | Активни доброволци: |
| `meta.flagged` | Flagged streams: | Маркирани потоци: |
| `meta.updated` | Updated: | Обновено: |
| `coverage.title` | Coverage | Покритие |
| `stat.total` | Total | Общо |
| `stat.enabled` | Enabled | Активни |
| `stat.covered` | Covered | Покрити |
| `stat.volunteers` | Volunteers | Доброволци |
| `upload.title` | Add / Update Sections | Добавяне / Обновяване на секции |
| `upload.btn` | Upload | Качване |
| `upload.file` | Choose file | Избор на файл |
| `upload.reset` | Reset all | Нулиране |
| `sections.title` | Sections ({n}) | Секции ({n}) |
| `sections.filter.placeholder` | Filter sections… | Филтриране на секции… |
| `flagged.title` | Flagged Streams | Маркирани потоци |
| `table.label` | Label | Етикет |
| `table.url` | URL | URL |
| `table.flag` | Flag | Маркировка |
| `table.firstseen` | First seen | Първо засечено |
| `table.duration` | Duration | Продължителност |
| `table.reports` | Reports | Доклади |
| `flagged.none` | No flagged streams | Няма маркирани потоци |
| `upload.paste.first` | Paste JSON first | Поставете JSON |
| `upload.invalid.json` | Invalid JSON: | Невалиден JSON: |
| `upload.not.array` | Expected a JSON array | Очаква се JSON масив |
| `upload.uploading` | Uploading… | Качване… |
| `upload.error` | Error: | Грешка: |
| `upload.noop` | No changes (all sections already up to date) | Няма промени (всички секции са актуални) |
| `upload.network.error` | Network error: | Мрежова грешка: |
| `upload.reset.done` | Reset: {n} streams loaded | Нулиране: заредени {n} потока |
| `confirm.reset` | This will DELETE all streams, sessions, and reports. Are you sure? | Това ще ИЗТРИЕ всички потоци, сесии и доклади. Сигурни ли сте? |
| `confirm.empty` | No JSON provided — this will wipe everything with nothing to replace it. Continue? | Не е предоставен JSON — това ще изтрие всичко. Продължаване? |
| `toggle.disable` | Disable | Деактивирай |
| `toggle.enable` | Enable | Активирай |
| `refresh.auto` | auto-refresh every 15s | автообновяване на всеки 15s |
| `refresh.error` | Connection error | Грешка при връзка |
| `time.sec.ago` | {n}s ago | преди {n}s |
| `time.min.ago` | {n}m ago | преди {n}m |
| `time.hour.ago` | {n}h {m}m ago | преди {n}ч {m}m |
