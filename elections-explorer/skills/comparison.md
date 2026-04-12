# Сравнение между избори — Comparison Chart

Използвай когато потребителят пита за: сравнение, тенденции, как се променят резултатите, партия X през годините, динамика.

## Технически бележки

- Chart.js CDN работи. Leaflet НЕ работи — но тук не е нужен.
- Ако потребителят поиска географско сравнение (карта), ползвай SVG подхода от `municipality-map.md`.

## SQL заявка

```sql
SELECT
  e.id AS election_id,
  e.name AS election_name,
  e.date,
  p.short_name,
  p.color,
  SUM(v.total) AS votes
FROM votes v
JOIN elections e ON e.id = v.election_id
JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
JOIN parties p ON ep.party_id = p.id
WHERE v.election_id IN ({ELECTION_IDS})
GROUP BY e.id, p.id
ORDER BY e.date, votes DESC
```

За неучаствали по избор:
```sql
SELECT
  election_id,
  SUM(registered_voters) AS registered,
  SUM(actual_voters) AS actual
FROM protocols
WHERE election_id IN ({ELECTION_IDS})
GROUP BY election_id
```

Параметри:
- `{ELECTION_IDS}` — списък от id-та, напр. `1,3,12,13,14,17,18` за всички парламентарни
- По подразбиране сравнявай всички парламентарни: `SELECT id FROM elections WHERE type='parliament' ORDER BY date`

## Как да рендерираш

1. Изпълни двете заявки.
2. Намери top 6-8 партии (по сума гласове в ПОСЛЕДНИЯ избор).
3. За всеки избор, изчисли % от регистрирани за всяка партия.
4. Добави серия "Неучаствали" с color="#CCCCCC".
5. Форматирай като JSON и вмъкни в шаблона.

## HTML шаблон

```html
<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Сравнение между избори</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&family=Hind:wght@400;600&family=Source+Code+Pro:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Hind', sans-serif; background: #fbfbfb; color: #333; padding: 20px; }
  h1 { font-family: 'EB Garamond', serif; font-size: 1.8rem; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 0.9rem; color: #666; margin-bottom: 24px; }
  .chart-container { background: #fff; border-radius: 8px; border: 1px solid #eee; padding: 20px; height: 500px; }
  .toggle { display: flex; gap: 8px; margin-bottom: 16px; }
  .toggle button { font-family: 'Hind', sans-serif; font-size: 0.8rem; padding: 6px 14px; border: 1px solid #ccc; border-radius: 20px; background: #fff; cursor: pointer; color: #666; transition: all 0.2s; }
  .toggle button.active { background: #ce463c; color: #fff; border-color: #ce463c; }
</style>
</head>
<body>

<h1>Сравнение между избори</h1>
<div class="subtitle" id="subtitle"></div>
<div class="toggle">
  <button id="btnBar" class="active" onclick="setType('bar')">Колони</button>
  <button id="btnLine" onclick="setType('line')">Линии</button>
</div>
<div class="chart-container">
  <canvas id="chart"></canvas>
</div>

<script>
const DATA = __DATA__;
// DATA format: { elections: [{id, name, date}], series: [{name, color, values: [pct per election]}] }
// values[i] corresponds to elections[i]

document.getElementById('subtitle').textContent = `${DATA.elections.length} избора, ${DATA.series.length} партии`;

const labels = DATA.elections.map(e => {
  const d = new Date(e.date);
  return d.toLocaleDateString('bg-BG', { month: 'short', year: '2-digit' });
});

let chart;
function createChart(type) {
  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('chart'), {
    type: type,
    data: {
      labels: labels,
      datasets: DATA.series.map(s => ({
        label: s.name,
        data: s.values,
        backgroundColor: s.color + (type === 'bar' ? 'CC' : '22'),
        borderColor: s.color,
        borderWidth: type === 'line' ? 2.5 : 0,
        borderRadius: type === 'bar' ? 4 : 0,
        pointRadius: type === 'line' ? 4 : 0,
        pointHoverRadius: type === 'line' ? 6 : 0,
        tension: 0.3,
        fill: type === 'line' ? false : undefined
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { family: 'Hind', size: 11 }, padding: 16, usePointStyle: true, pointStyle: 'rectRounded' }
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%` },
          titleFont: { family: 'Hind' },
          bodyFont: { family: 'Source Code Pro' }
        }
      },
      scales: {
        x: {
          ticks: { font: { family: 'Source Code Pro', size: 11 } },
          grid: { display: false }
        },
        y: {
          ticks: { font: { family: 'Source Code Pro', size: 11 }, callback: v => v + '%' },
          grid: { color: '#f0f0f0' },
          beginAtZero: true
        }
      }
    }
  });
}

function setType(type) {
  document.getElementById('btnBar').classList.toggle('active', type === 'bar');
  document.getElementById('btnLine').classList.toggle('active', type === 'line');
  createChart(type);
}

createChart('bar');
</script>
</body>
</html>
```
