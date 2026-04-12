# Карта по общини — Municipality Map

Използвай когато потребителят пита за: карта на резултатите, кой води по общини, географско разпределение, коя партия печели къде.

## ВАЖНО: Технически ограничения

- **НЕ използвай Leaflet** — CDN-ът не се зарежда в sandbox средата.
- **НЕ използвай Mercator проекция** — y-обхватът на България е ~0.07 Mercator единици, което дава HEIGHT ~10px.
- Генерирай **чист SVG** с **equirectangular проекция** с cos(lat) корекция.
- Целият HTML е self-contained — без външни JS библиотеки (само Google Fonts).

## SQL заявки

### 1. Общини с протоколи

```sql
SELECT m.id AS municipality_id, m.name AS municipality_name, d.name AS district_name, m.geo,
  SUM(pr.registered_voters) AS registered, SUM(pr.actual_voters) AS actual
FROM municipalities m
JOIN districts d ON m.district_id = d.id
JOIN locations l ON l.municipality_id = m.id
JOIN sections s ON s.location_id = l.id AND s.election_id = {ELECTION_ID}
JOIN protocols pr ON pr.election_id = s.election_id AND pr.section_code = s.section_code
WHERE m.geo IS NOT NULL
GROUP BY m.id
```

### 2. Резултати по партии на ниво община

```sql
SELECT l.municipality_id, p.short_name, p.color, SUM(v.total) AS votes
FROM votes v
JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
JOIN locations l ON s.location_id = l.id
JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
JOIN parties p ON ep.party_id = p.id
WHERE v.election_id = {ELECTION_ID}
GROUP BY l.municipality_id, p.id
ORDER BY l.municipality_id, votes DESC
```

## Проекция: Equirectangular с cos(lat) корекция

```python
import math

MIN_LNG, MAX_LNG = 22.2, 28.8
MIN_LAT, MAX_LAT = 41.15, 44.3
CENTER_LAT = (MIN_LAT + MAX_LAT) / 2
COS_LAT = math.cos(math.radians(CENTER_LAT))

x_range = (MAX_LNG - MIN_LNG) * COS_LAT
y_range = MAX_LAT - MIN_LAT
WIDTH = 960
HEIGHT = int(WIDTH * y_range / x_range)  # ≈ 623

def to_svg(lng, lat):
    sx = (lng - MIN_LNG) / (MAX_LNG - MIN_LNG) * WIDTH
    sy = (MAX_LAT - lat) / (MAX_LAT - MIN_LAT) * HEIGHT
    return sx, sy
```

## GeoJSON → SVG path

```python
def coords_to_path(ring):
    parts = []
    for i, pt in enumerate(ring):
        sx, sy = to_svg(pt[0], pt[1])
        parts.append(f"{'M' if i==0 else 'L'}{sx:.1f},{sy:.1f}")
    parts.append('Z')
    return ''.join(parts)

def geo_to_paths(geo):
    paths = []
    if geo['type'] == 'Polygon':
        for ring in geo['coordinates']:
            paths.append(coords_to_path(ring))
    elif geo['type'] == 'MultiPolygon':
        for poly in geo['coordinates']:
            for ring in poly:
                paths.append(coords_to_path(ring))
    return ' '.join(paths)
```

## SVG path формат

Всеки path ТРЯБВА да има `data-i` (индекс в JS масива) и `data-r` (ранг: 0=първа, 1=втора, 2=трета партия). Тези атрибути са нужни за интерактивното маркиране.

```html
<path d="{path_d}" fill="{color}" fill-opacity="0.6"
      stroke="#fff" stroke-width="0.8" data-i="{index}" data-r="{rank}" class="mun"/>
```

## JS данни за tooltip

```python
js_data.append({
    'name': municipality_name,
    'district': district_name,
    'actual': actual,
    'turnout': round((actual/registered)*100, 1),
    'top3': [{'name': short_name, 'color': color, 'votes': votes,
              'pct': round((votes/actual)*100, 1)}]  # процент от ГЛАСУВАЛИТЕ
})
```

## Интерактивност — ЗАДЪЛЖИТЕЛНО

### 1. Легенда маркира общини в своята карта

При hover на партия в легендата: съответните общини се подчертават (opacity 0.9, stroke #333), останалите избледняват (opacity 0.08, stroke #eee). Matching-ът е **по име на партия от JS данните**, НЕ по цвят (цветовете в CSS и атрибутите може да са в различен формат — rgb vs hex).

### 2. Национален бар маркира партия на ТРИТЕ карти едновременно

Ако има обобщаващ бар с национални проценти (.nb-item), при hover трябва да маркира партията на ВСИЧКИ карти — не само на една.

### JS за интерактивност

```javascript
const allPaths = document.querySelectorAll('.mun');
const cards = document.querySelectorAll('.map-card');

// Извличане на име на партия от легенда елемент
function getLrParty(lr) {
  const clone = lr.cloneNode(true);
  clone.querySelectorAll('.lc,.ln').forEach(s => s.remove());
  return clone.textContent.trim();
}
function getNbParty(nb) {
  const clone = nb.cloneNode(true);
  clone.querySelectorAll('.tc,.nb-pct').forEach(s => s.remove());
  return clone.textContent.trim();
}

function dimPath(p) { p.setAttribute('fill-opacity','0.08'); p.setAttribute('stroke','#eee'); p.setAttribute('stroke-width','0.3'); }
function highlightPath(p) { p.setAttribute('fill-opacity','0.9'); p.setAttribute('stroke','#333'); p.setAttribute('stroke-width','1.8'); }
function resetPath(p) { p.setAttribute('fill-opacity','0.6'); p.setAttribute('stroke','#fff'); p.setAttribute('stroke-width','0.8'); }

function pathHasParty(p, partyName) {
  const i = +p.dataset.i, r = +p.dataset.r;
  const m = D[i];
  return m && m.top3[r] && m.top3[r].name === partyName;
}

// Per-card legend highlight
cards.forEach(card => {
  const paths = card.querySelectorAll('.mun');
  const legend = card.querySelector('.legend');
  if (!legend) return;
  legend.querySelectorAll('.lr').forEach(lr => {
    const party = getLrParty(lr);
    lr.addEventListener('mouseenter', () => {
      lr.classList.add('active');
      paths.forEach(p => { if (pathHasParty(p, party)) highlightPath(p); else dimPath(p); });
    });
    lr.addEventListener('mouseleave', () => {
      lr.classList.remove('active');
      paths.forEach(p => resetPath(p));
    });
  });
});

// National bar: highlight across ALL maps
document.querySelectorAll('.nb-item').forEach(nb => {
  const party = getNbParty(nb);
  nb.addEventListener('mouseenter', () => {
    nb.classList.add('active');
    allPaths.forEach(p => { if (pathHasParty(p, party)) highlightPath(p); else dimPath(p); });
  });
  nb.addEventListener('mouseleave', () => {
    nb.classList.remove('active');
    allPaths.forEach(p => resetPath(p));
  });
});
```

## CSS за интерактивни елементи

```css
.mun { cursor:pointer; transition:fill-opacity 0.15s, stroke-width 0.15s; }
.mun:hover { fill-opacity:0.85; stroke-width:2; }
.lr { display:flex; align-items:center; gap:6px; cursor:pointer; padding:2px 4px; border-radius:4px; transition:background 0.15s; }
.lr:hover { background:#f0f0f0; }
.lr.active { background:#e8e8e8; }
.nb-item { cursor:pointer; padding:2px 6px; border-radius:4px; transition:background 0.15s; }
.nb-item:hover { background:#f0f0f0; }
.nb-item.active { background:#e8e8e8; }
```

## Layout: Легендата е ПОД картата

Легендата НИКОГА не е position:absolute върху картата. Винаги е отделен div под SVG-то с `display:flex; flex-wrap:wrap`.

```html
<div class="map-card">
  <h2>Заглавие</h2>
  <svg>...</svg>
  <div class="legend">
    <div class="legend-title" style="width:100%">Победител по общини</div>
    <!-- .lr items -->
  </div>
</div>
```

## Multi-map layout (когато има няколко карти)

Ако потребителят поиска повече от една карта (напр. 1-ва, 2-ра, 3-та партия), използвай CSS grid:

```css
.maps-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px; margin-bottom:32px; }
@media (max-width:800px) { .maps-grid { grid-template-columns:1fr; } }
```

Всяка карта е `.map-card` с вътрешна `.legend`. SVG path-овете се генерират отделно за всяка карта с различен `data-r` (0, 1, 2).
