# Избори в България — Анализ на данни

Тази директория съдържа `elections.db` — SQLite база с резултати от 18 български избора (2021–2024): парламентарни, президентски, европейски, местни.

## Как да работиш

1. Потребителят пита на български. Отговаряй на български.
2. Изпълни SQL заявка срещу `elections.db` (sqlite3 CLI или Python sqlite3).
3. Визуализирай резултата като HTML artifact — ВИНАГИ използвай skill шаблон.
4. Никога не показвай сурови таблици — винаги визуализация.

## Маршрутизация — кой skill да заредиш

| Потребителят пита за... | Зареди |
|---|---|
| Риск, аномалии, съмнителни секции | `skills/risk-map.md` |
| Резултати от избори / регион | `skills/results-chart.md` |
| Резултати на карта по общини | `skills/municipality-map.md` |
| Сравнение между избори | `skills/comparison.md` |
| Избирателна активност | `skills/turnout.md` |

## Схема на базата

```
elections (id, slug, name, type, date, round)
sections (id, election_id, section_code, location_id, rik_code, is_mobile, machine_count)
locations (id, ekatte, settlement_name, address, municipality_id, kmetstvo_id, district_id, rik_id, lat, lng)
protocols (id, election_id, section_code, registered_voters, added_voters, actual_voters, invalid_votes, null_votes)
votes (election_id, section_code, party_number, total, paper, machine)  -- PK: all three
parties (id, canonical_name, short_name, party_type, color, wiki_url)
election_parties (election_id, ballot_number, party_id, name_on_ballot)
section_scores (election_id, section_code, risk_score, turnout_rate, turnout_zscore,
  benford_chi2, benford_p, benford_score, peer_vote_deviation, arithmetic_error,
  vote_sum_mismatch, benford_risk, peer_risk, acf_risk, acf_multicomponent,
  acf_turnout_shift_norm, acf_party_shift_norm, section_type)
municipalities (id, oik_code, name, district_id, geo)  -- geo = GeoJSON polygon
districts (id, name, geo)
riks (id, oik_prefix, name, geo)
kmetstva (id, name, type, municipality_id, ekatte, geo)
coalition_members (coalition_id, member_party_id)
```

## Ключови JOIN-ове

- votes → parties: `JOIN election_parties ep ON ep.election_id=v.election_id AND ep.ballot_number=v.party_number JOIN parties p ON ep.party_id=p.id`
- sections → locations: `JOIN sections s ON ... JOIN locations l ON s.location_id=l.id`
- section_scores → coordinates: през sections → locations (l.lat, l.lng)

## UX правила — за всички визуализации

### Технически ограничения
- **Leaflet CDN НЕ работи** в sandbox средата. За карти ползвай чист SVG с equirectangular проекция.
- **Chart.js CDN работи** — ползвай за bar/line charts.
- Никакви други външни JS библиотеки — само Google Fonts.

### Интерактивност — ЗАДЪЛЖИТЕЛНО за всички карти и графики
- **Легенда маркира елементи**: hover на партия в легенда → подчертай съответните общини/секции (opacity 0.9, stroke #333), избледни останалите (opacity 0.08, stroke #eee).
- **Национален бар маркира на ВСИЧКИ карти**: ако има обобщаващ бар с партии горе, hover на партия маркира навсякъде.
- **Matching по ИМЕ на партия** от JS данните, НЕ по цвят (rgb vs hex несъвместимост).
- **Tooltip при hover** на община/секция — показва топ 3 партии, активност, район.

### Layout правила
- Легендата е ВИНАГИ ПОД картата (flex-wrap), никога position:absolute върху нея.
- Multi-map layout: CSS grid `1fr 1fr 1fr` за 3 карти, responsive `1fr` под 800px.
- SVG пътища задължително имат `data-i` (индекс) и `data-r` (ранг) атрибути.

### CSS за интерактивни елементи
```css
.lr { cursor:pointer; padding:2px 4px; border-radius:4px; transition:background 0.15s; }
.lr:hover { background:#f0f0f0; }
.lr.active { background:#e8e8e8; }
.nb-item { cursor:pointer; padding:2px 6px; border-radius:4px; transition:background 0.15s; }
.nb-item:hover { background:#f0f0f0; }
.nb-item.active { background:#e8e8e8; }
```

## Правила за заявки

- **Неучаствали = registered_voters − actual_voters** — показвай ги ВИНАГИ, с цвят #CCCCCC, етикет "Неучаствали"
- party_number в votes отговаря на ballot_number в election_parties (НЕ на parties.id)
- За географски филтър: locations.municipality_id, locations.district_id, locations.rik_id
- section_type: 'normal', 'mobile', 'abroad', 'ship' — по подразбиране филтрирай само 'normal'
- GeoJSON в municipalities.geo е готов за SVG рендериране (type: Polygon/MultiPolygon, coordinates масив)

## Речник BG ↔ EN

секция = polling section, РИК = regional election commission, кметство = mayoralty,
община = municipality, област = district, избирателна активност = voter turnout,
недействителни = invalid votes, бюлетини = ballots, протокол = protocol

## Брандиране (за всички artifact-и)

- Fonts: EB Garamond (заглавия), Hind (текст), Source Code Pro (числа/данни)
- CDN: `https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&family=Hind:wght@400;600&family=Source+Code+Pro:wght@400;600&display=swap`
- Цветове: `#ce463c` (акцент), `#333` (текст), `#666` (вторичен), `#fbfbfb` (фон), `#CCCCCC` (неучаствали)
- Без градиенти. Червеното е единственият акцент.
- Всички надписи на български.

## Налични избори

| id | Име | Дата | Тип |
|---|---|---|---|
| 1 | Народно събрание 27.10.2024 | 2024-10-27 | parliament |
| 3 | Народно събрание 09.06.2024 | 2024-06-09 | parliament |
| 4 | Европейски парламент 09.06.2024 | 2024-06-09 | european |
| 5 | Общ.съветници 29.10.2023 | 2023-10-29 | local_council |
| 12 | Народно събрание 02.04.2023 | 2023-04-02 | parliament |
| 13 | Народно събрание 02.10.2022 | 2022-10-02 | parliament |
| 14 | Народно събрание 14.11.2021 | 2021-11-14 | parliament |
| 17 | Народно събрание 11.07.2021 | 2021-07-11 | parliament |
| 18 | Народно събрание 04.04.2021 | 2021-04-04 | parliament |

По подразбиране използвай **id=1** (последните парламентарни избори, 27.10.2024).
