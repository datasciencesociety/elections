# Карта на риска — Risk Map

Използвай когато потребителят пита за: аномалии, съмнителни секции, риск, подозрителни резултати, манипулации.

## ВАЖНО: Технически ограничения

- **НЕ използвай Leaflet** — CDN-ът не се зарежда в sandbox средата.
- Генерирай **чист SVG** scatter plot с equirectangular проекция (същата като municipality-map).
- Точките са SVG `<circle>` елементи с радиус и opacity пропорционални на risk_score.

## SQL заявка

```sql
SELECT
  ss.section_code, l.settlement_name, l.lat, l.lng,
  ss.risk_score, ss.turnout_rate,
  ss.benford_risk, ss.peer_risk, ss.acf_risk, ss.acf_multicomponent,
  ss.arithmetic_error, ss.vote_sum_mismatch,
  ss.turnout_zscore, ss.benford_chi2, ss.peer_vote_deviation,
  p.registered_voters, p.actual_voters,
  m.name AS municipality_name, d.name AS district_name
FROM section_scores ss
JOIN sections s ON s.election_id = ss.election_id AND s.section_code = ss.section_code
JOIN locations l ON s.location_id = l.id
LEFT JOIN protocols p ON p.election_id = ss.election_id AND p.section_code = ss.section_code
LEFT JOIN municipalities m ON l.municipality_id = m.id
LEFT JOIN districts d ON l.district_id = d.id
WHERE ss.election_id = {ELECTION_ID}
  AND l.lat IS NOT NULL
  AND ss.risk_score >= {MIN_RISK}
  AND ss.section_type = 'normal'
ORDER BY ss.risk_score DESC
LIMIT 500
```

Параметри:
- `{ELECTION_ID}` — по подразбиране 1
- `{MIN_RISK}` — по подразбиране 0.3

## Проекция — същата като municipality-map

```python
import math
MIN_LNG, MAX_LNG = 22.2, 28.8
MIN_LAT, MAX_LAT = 41.15, 44.3
WIDTH = 960
HEIGHT = int(WIDTH * (MAX_LAT-MIN_LAT) / ((MAX_LNG-MIN_LNG) * math.cos(math.radians((MIN_LAT+MAX_LAT)/2))))

def to_svg(lng, lat):
    return ((lng-MIN_LNG)/(MAX_LNG-MIN_LNG)*WIDTH, (MAX_LAT-lat)/(MAX_LAT-MIN_LAT)*HEIGHT)
```

## SVG точки

```python
for d in data:
    sx, sy = to_svg(d['lng'], d['lat'])
    r = 3 + d['risk_score'] * 10     # radius 3–13
    op = 0.3 + d['risk_score'] * 0.7  # opacity 0.3–1.0
    circles.append(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="{r:.1f}" '
                   f'fill="#ce463c" fill-opacity="{op:.2f}" '
                   f'stroke="#ce463c" stroke-width="0.5" stroke-opacity="{op*0.8:.2f}" '
                   f'data-i="{i}" class="dot"/>')
```

## Интерактивност

### Risk slider — филтър по минимален риск

HTML `<input type="range">` контролира видимостта на точките. JS скрива/показва точки чрез `display:none` вместо да пререндерира.

### Methodology filter — dropdown за benford/peer/acf/combined

Сменя кой risk score определя видимостта.

### Tooltip при hover

```javascript
dot.addEventListener('mouseenter', e => {
  const d = D[+dot.dataset.i];
  // show tooltip with risk_score, turnout, benford, peer, acf details
});
```

## Контури на общините (фон)

За по-добър контекст, добави контурите на общините като фон layer ПРЕДИ точките:

```python
# Зареди municipalities.geo и рендерирай като бледи полигони
bg_paths.append(f'<path d="{geo_to_paths(geo)}" fill="none" stroke="#ddd" stroke-width="0.5"/>')
```

## CSS

```css
.dot { cursor:pointer; transition:r 0.15s; }
.dot:hover { r:16; stroke-width:2; }
```

## HTML структура

```html
<h1>Карта на аномалиите</h1>
<div class="subtitle">N секции с риск ≥ 0.30</div>
<div class="stats">...</div>
<div class="controls">
  <label>Мин. риск: <input type="range" id="riskSlider" min="0" max="1" step="0.05" value="0.3"> <span id="riskVal">0.30</span></label>
  <label>Методология: <select id="methodFilter">...</select></label>
</div>
<div class="legend">
  <div class="legend-item"><div class="legend-dot" style="background:rgba(206,70,60,0.3)"></div> Нисък</div>
  <div class="legend-item"><div class="legend-dot" style="background:rgba(206,70,60,0.6)"></div> Среден</div>
  <div class="legend-item"><div class="legend-dot" style="background:rgba(206,70,60,1.0)"></div> Висок</div>
</div>
<div class="map-wrap">
  <svg viewBox="0 0 960 623">
    <!-- bg municipality outlines -->
    <!-- risk circles -->
  </svg>
</div>
```
