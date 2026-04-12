# Резултати от избори — Results Chart

Използвай когато потребителят пита за: резултати, кой спечели, колко гласа, разпределение на гласовете, за конкретен избор или регион.

## SQL заявка

```sql
SELECT p.short_name, p.color, SUM(v.total) AS votes
FROM votes v
JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
JOIN parties p ON ep.party_id = p.id
WHERE v.election_id = {ELECTION_ID}
GROUP BY p.id, p.short_name, p.color
ORDER BY votes DESC
```

За географски филтър добави JOIN:
```sql
JOIN sections s ON s.election_id = v.election_id AND s.section_code = v.section_code
JOIN locations l ON s.location_id = l.id
WHERE ... AND l.municipality_id = {MUN_ID}  -- или l.district_id, l.rik_id
```

За неучаствали:
```sql
SELECT SUM(p.registered_voters) AS registered, SUM(p.actual_voters) AS actual
FROM protocols p
WHERE p.election_id = {ELECTION_ID}
```

## Как да рендерираш

1. Изпълни двете заявки (гласове по партии + неучаствали).
2. Изчисли `non_voters = registered - actual`.
3. Добави "Неучаствали" като първи елемент с color="#CCCCCC".
4. Изчисли процент за всяка партия от `registered` (не от `actual`).
5. Вмъкни данните в шаблона.
6. Рендерирай като HTML artifact.

ВАЖНО: Процентите се изчисляват от РЕГИСТРИРАНИ, не от гласували. Неучаствалите са най-голямата "партия".

## Chart.js CDN

Chart.js CDN работи в sandbox средата. Leaflet НЕ работи — но Chart.js е ОК.

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
```

## Интерактивност

Chart.js предоставя hover tooltips по подразбиране. Допълнително:

- Ако има summary bar горе с партии (.nb-item), при hover трябва да подчертава съответния бар в графиката.
- Ако има легенда под графиката, при hover да подчертава партията.

## HTML шаблон

```html
<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Резултати от избори</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&family=Hind:wght@400;600&family=Source+Code+Pro:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Hind', sans-serif; background: #fbfbfb; color: #333; padding: 20px; }
  h1 { font-family: 'EB Garamond', serif; font-size: 1.8rem; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 0.9rem; color: #666; margin-bottom: 20px; }
  .stats { display: flex; gap: 32px; margin-bottom: 24px; padding: 16px; background: #fff; border-radius: 8px; border: 1px solid #eee; }
  .stat-item { text-align: center; }
  .stat-value { font-family: 'Source Code Pro', monospace; font-size: 1.4rem; font-weight: 600; }
  .stat-label { font-size: 0.75rem; color: #666; }
  .stat-accent { color: #ce463c; }
  .chart-container { background: #fff; border-radius: 8px; border: 1px solid #eee; padding: 20px; }
  canvas { max-height: 600px; }
</style>
</head>
<body>

<h1 id="title"></h1>
<div class="subtitle" id="subtitle"></div>
<div class="stats" id="statsBar"></div>
<div class="chart-container">
  <canvas id="chart"></canvas>
</div>

<script>
const DATA = __DATA__;
// DATA: { election_name, subtitle, registered, actual, parties: [{name, votes, color}] }

const nonVoters = DATA.registered - DATA.actual;
const turnoutPct = ((DATA.actual / DATA.registered) * 100).toFixed(1);

document.getElementById('title').textContent = DATA.election_name;
document.getElementById('subtitle').textContent = DATA.subtitle || '';
document.getElementById('statsBar').innerHTML = `
  <div class="stat-item"><div class="stat-value">${DATA.registered.toLocaleString('bg-BG')}</div><div class="stat-label">Регистрирани</div></div>
  <div class="stat-item"><div class="stat-value">${DATA.actual.toLocaleString('bg-BG')}</div><div class="stat-label">Гласували</div></div>
  <div class="stat-item"><div class="stat-value stat-accent">${nonVoters.toLocaleString('bg-BG')}</div><div class="stat-label">Неучаствали</div></div>
  <div class="stat-item"><div class="stat-value">${turnoutPct}%</div><div class="stat-label">Активност</div></div>
`;

const all = [
  { name: 'Неучаствали', votes: nonVoters, color: '#CCCCCC' },
  ...DATA.parties
];

const labels = all.map(d => d.name);
const values = all.map(d => d.votes);
const colors = all.map(d => d.color || '#999');
const percentages = all.map(d => ((d.votes / DATA.registered) * 100).toFixed(1));

new Chart(document.getElementById('chart'), {
  type: 'bar',
  data: {
    labels: labels,
    datasets: [{
      data: values,
      backgroundColor: colors,
      borderWidth: 0,
      borderRadius: 4
    }]
  },
  options: {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const v = ctx.raw.toLocaleString('bg-BG');
            const p = percentages[ctx.dataIndex];
            return ` ${v} гласа (${p}%)`;
          }
        },
        titleFont: { family: 'Hind' },
        bodyFont: { family: 'Source Code Pro' }
      }
    },
    scales: {
      x: {
        ticks: { font: { family: 'Source Code Pro', size: 11 }, callback: v => v.toLocaleString('bg-BG') },
        grid: { color: '#f0f0f0' }
      },
      y: {
        ticks: { font: { family: 'Hind', size: 12 } },
        grid: { display: false }
      }
    }
  }
});
</script>
</body>
</html>
```
