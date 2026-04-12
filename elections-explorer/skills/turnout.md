# Избирателна активност — Turnout

Използвай когато потребителят пита за: активност, колко хора гласуваха, участие, явка, неучаствали, регистрирани, кой район/община има най-ниска активност.

## Технически бележки

- Chart.js CDN работи. Leaflet НЕ работи.
- Ако потребителят поиска карта на активността по общини, ползвай SVG подхода от `municipality-map.md` с цвят базиран на turnout_pct (gradient от бледо до наситено #ce463c).

## SQL заявка

По области (districts):
```sql
SELECT
  d.name AS unit_name,
  SUM(pr.registered_voters) AS registered,
  SUM(pr.actual_voters) AS actual,
  ROUND(CAST(SUM(pr.actual_voters) AS REAL) / SUM(pr.registered_voters) * 100, 1) AS turnout_pct
FROM protocols pr
JOIN sections s ON s.election_id = pr.election_id AND s.section_code = pr.section_code
JOIN locations l ON s.location_id = l.id
JOIN districts d ON l.district_id = d.id
WHERE pr.election_id = {ELECTION_ID}
GROUP BY d.id
ORDER BY turnout_pct ASC
```

По общини (municipalities):
```sql
SELECT
  m.name AS unit_name,
  d.name AS district_name,
  SUM(pr.registered_voters) AS registered,
  SUM(pr.actual_voters) AS actual,
  ROUND(CAST(SUM(pr.actual_voters) AS REAL) / SUM(pr.registered_voters) * 100, 1) AS turnout_pct
FROM protocols pr
JOIN sections s ON s.election_id = pr.election_id AND s.section_code = pr.section_code
JOIN locations l ON s.location_id = l.id
JOIN municipalities m ON l.municipality_id = m.id
JOIN districts d ON m.district_id = d.id
WHERE pr.election_id = {ELECTION_ID}
GROUP BY m.id
ORDER BY turnout_pct ASC
```

За обобщение:
```sql
SELECT
  SUM(registered_voters) AS total_registered,
  SUM(actual_voters) AS total_actual
FROM protocols
WHERE election_id = {ELECTION_ID}
```

Параметри:
- `{ELECTION_ID}` — по подразбиране 1
- Ниво на групиране: district (по подразбиране) или municipality (ако потребителят поиска)

## Как да рендерираш

1. Изпълни заявката за обобщение и за детайли.
2. Изчисли non_voters = registered − actual за всяка единица.
3. Сортирай по turnout_pct ASC (най-ниска активност първа).
4. Вмъкни в шаблона.

## HTML шаблон

```html
<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Избирателна активност</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&family=Hind:wght@400;600&family=Source+Code+Pro:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Hind', sans-serif; background: #fbfbfb; color: #333; padding: 20px; }
  h1 { font-family: 'EB Garamond', serif; font-size: 1.8rem; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 0.9rem; color: #666; margin-bottom: 20px; }
  .summary { display: flex; gap: 24px; margin-bottom: 24px; flex-wrap: wrap; }
  .summary-card { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 16px 24px; min-width: 140px; }
  .summary-value { font-family: 'Source Code Pro', monospace; font-size: 1.6rem; font-weight: 600; }
  .summary-label { font-size: 0.75rem; color: #666; margin-top: 2px; }
  .summary-accent { color: #ce463c; }
  .chart-container { background: #fff; border-radius: 8px; border: 1px solid #eee; padding: 20px; }
  .chart-scroll { max-height: 600px; overflow-y: auto; }
  canvas { width: 100% !important; }
</style>
</head>
<body>

<h1>Избирателна активност</h1>
<div class="subtitle" id="subtitle"></div>
<div class="summary" id="summary"></div>
<div class="chart-container">
  <div class="chart-scroll">
    <canvas id="chart"></canvas>
  </div>
</div>

<script>
const DATA = __DATA__;
// DATA format: { election_name, total_registered, total_actual, units: [{name, registered, actual, turnout_pct}] }

const totalNonVoters = DATA.total_registered - DATA.total_actual;
const totalPct = ((DATA.total_actual / DATA.total_registered) * 100).toFixed(1);

document.getElementById('subtitle').textContent = DATA.election_name;
document.getElementById('summary').innerHTML = `
  <div class="summary-card"><div class="summary-value">${DATA.total_registered.toLocaleString('bg-BG')}</div><div class="summary-label">Регистрирани избиратели</div></div>
  <div class="summary-card"><div class="summary-value">${DATA.total_actual.toLocaleString('bg-BG')}</div><div class="summary-label">Гласували</div></div>
  <div class="summary-card"><div class="summary-value summary-accent">${totalNonVoters.toLocaleString('bg-BG')}</div><div class="summary-label">Неучаствали</div></div>
  <div class="summary-card"><div class="summary-value">${totalPct}%</div><div class="summary-label">Обща активност</div></div>
`;

const labels = DATA.units.map(u => u.name);
const actual = DATA.units.map(u => u.actual);
const nonVoters = DATA.units.map(u => u.registered - u.actual);

// Dynamic height based on number of units
const canvas = document.getElementById('chart');
canvas.style.height = Math.max(400, DATA.units.length * 28) + 'px';

new Chart(canvas, {
  type: 'bar',
  data: {
    labels: labels,
    datasets: [
      {
        label: 'Гласували',
        data: actual,
        backgroundColor: '#ce463c',
        borderRadius: 3,
        borderSkipped: false
      },
      {
        label: 'Неучаствали',
        data: nonVoters,
        backgroundColor: '#CCCCCC',
        borderRadius: 3,
        borderSkipped: false
      }
    ]
  },
  options: {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: { font: { family: 'Hind', size: 12 }, padding: 16, usePointStyle: true, pointStyle: 'rectRounded' }
      },
      tooltip: {
        callbacks: {
          afterLabel: (ctx) => {
            const idx = ctx.dataIndex;
            const unit = DATA.units[idx];
            return `Активност: ${unit.turnout_pct}%`;
          }
        },
        titleFont: { family: 'Hind' },
        bodyFont: { family: 'Source Code Pro' }
      }
    },
    scales: {
      x: {
        stacked: true,
        ticks: { font: { family: 'Source Code Pro', size: 11 }, callback: v => v.toLocaleString('bg-BG') },
        grid: { color: '#f0f0f0' }
      },
      y: {
        stacked: true,
        ticks: { font: { family: 'Hind', size: 11 } },
        grid: { display: false }
      }
    }
  }
});
</script>
</body>
</html>
```
