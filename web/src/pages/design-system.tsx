const BG_SPECIMEN = "Държавата · гражданите · наблюдение на протокола";
const GLYPH_SPECIMEN = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ абвгдежзийклмнопрстуфхцчшщъьюя";

const TYPE_SCALE = [
  { name: "2xs", px: 10, use: "micro (sparkline labels)" },
  { name: "xs", px: 12, use: "eyebrow · caption" },
  { name: "sm", px: 14, use: "dense UI · tables · drawer labels" },
  { name: "base", px: 16, use: "UI body · chips · buttons" },
  { name: "md", px: 18, use: "reading body · prose · lists" },
  { name: "xl", px: 20, use: "h3 desktop" },
  { name: "2xl", px: 24, use: "h1 mobile · h2 desktop" },
  { name: "3xl", px: 30, use: "h1 desktop" },
];

const SPACING = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128];

const LINE_HEIGHT = [
  { name: "2xs", px: 10, lh: 14 },
  { name: "xs", px: 12, lh: 16 },
  { name: "sm", px: 14, lh: 20 },
  { name: "base", px: 16, lh: 24 },
  { name: "md", px: 18, lh: 28 },
  { name: "xl", px: 20, lh: 28 },
  { name: "2xl", px: 24, lh: 32 },
  { name: "3xl", px: 30, lh: 36 },
];

const STACK_RHYTHM = [
  { between: "параграф → параграф", gap: 16 },
  { between: "параграф → h3", gap: 24 },
  { between: "параграф → h2", gap: 32 },
  { between: "h3 → съдържание", gap: 8 },
  { between: "h2 → съдържание", gap: 12 },
  { between: "карта → карта", gap: 16 },
  { between: "раздел → раздел", gap: 48 },
];

const INNER_PADDING = [
  { name: "chip", p: "2 × 6", demo: { py: 2, px: 6, content: "0.62" } },
  { name: "card small", p: "12", demo: { py: 12, px: 12, content: "Секция 232800035" } },
  { name: "card default", p: "16", demo: { py: 16, px: 16, content: "Секция 232800035" } },
  { name: "card comfortable", p: "24", demo: { py: 24, px: 24, content: "Секция 232800035" } },
  { name: "drawer / panel", p: "24", demo: { py: 24, px: 24, content: "Панел за секция" } },
];

const RESPONSIVE_TYPE = [
  { step: "h1", mobile: 24, tablet: 24, desktop: 30 },
  { step: "h2", mobile: 20, tablet: 20, desktop: 24 },
  { step: "h3", mobile: 18, tablet: 18, desktop: 20 },
  { step: "reading body", mobile: 18, tablet: 18, desktop: 18 },
  { step: "UI body", mobile: 16, tablet: 16, desktop: 16 },
  { step: "eyebrow", mobile: 12, tablet: 12, desktop: 12 },
];

const BREAKPOINTS = [
  { tier: "mobile", range: "< 768px", prefix: "—" },
  { tier: "tablet", range: "768–1023px", prefix: "md:" },
  { tier: "desktop", range: "≥ 1024px", prefix: "lg:" },
];

const NEUTRALS = [
  { token: "--background", hex: "#fbfbfb", use: "page" },
  { token: "--card", hex: "#ffffff", use: "raised surface" },
  { token: "--secondary / --muted", hex: "#f5f3f0", use: "warm off-white panel" },
  { token: "--foreground", hex: "#333333", use: "body text" },
  { token: "--muted-foreground", hex: "#877e75", use: "warm grey label" },
  { token: "--border", hex: "#e8e4df", use: "hairline border" },
];

const ACCENT = [
  { token: "brand", hex: "#ce463c", use: "sole UI accent · attention · destructive" },
  { token: "brand-green", hex: "#3d6b4a", use: "tricolor detail only (logo tab, favicon)" },
  { token: "sand", hex: "#f0ead8", use: "tertiary editorial surface (rare)" },
];

const SCORE = [
  { token: "score-high", hex: "#ce463c", use: "≥ 0.6 · strong deviation" },
  { token: "score-medium", hex: "#9a6a1f", use: "0.3–0.6 · middling" },
  { token: "score-low", hex: "#a8a096", use: "< 0.3 · within norm" },
];

const KNOWN_GAPS = [
  "Логото. Итерирахме няколко пъти, нищо не издържа. До ново решение ползваме само словесна марка.",
  "Правилата за визуализации (графики, sparkline) са недодефинирани.",
  "Решение за тъмен режим — отложено. Токените съществуват, но не се поддържат активно.",
  "Липсва print stylesheet.",
  "Mobile изглед на секцията (full-screen drawer) чака QA.",
  "Иконите трябва да се одитират — възможно е някъде да се ползват декоративно.",
  "Микро-типография (7–9px надписи под sparkline-и) е под минималния размер в скалата (10px / text-2xs). Трябва решение: да се вдигне или да се премахне.",
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-border pt-12 pb-4 first:border-t-0 first:pt-0">
      <h2 className="mb-2 font-display text-2xl font-medium tracking-tight">{title}</h2>
      <div className="mb-6 red-bar" aria-hidden />
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium uppercase tracking-eyebrow text-muted-foreground">
      {children}
    </div>
  );
}

function SwatchRow({ items }: { items: { token: string; hex: string; use: string }[] }) {
  return (
    <div className="divide-y divide-border border border-border">
      {items.map((i) => (
        <div key={i.token} className="flex items-center gap-4 px-3 py-2">
          <span
            className="h-8 w-8 shrink-0 border border-border"
            style={{ background: i.hex }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xs tabular-nums">{i.hex}</div>
            <div className="text-sm">{i.use}</div>
          </div>
          <code className="hidden font-mono text-xs text-muted-foreground md:block">{i.token}</code>
        </div>
      ))}
    </div>
  );
}

export default function DesignSystem() {
  const nav = [
    { id: "intro", label: "Въведение" },
    { id: "typography", label: "Типография" },
    { id: "headings", label: "Заглавия" },
    { id: "eyebrow", label: "Eyebrow" },
    { id: "colors", label: "Цветове" },
    { id: "scores", label: "Аномалии" },
    { id: "spacing", label: "Разредка" },
    { id: "rhythm", label: "Ритъм" },
    { id: "padding", label: "Вътрешни отстъпи" },
    { id: "radii", label: "Радиуси · рамки" },
    { id: "responsive", label: "Responsive" },
    { id: "components", label: "Примитиви" },
    { id: "app-components", label: "В приложението" },
    { id: "known-gaps", label: "Над какво работим" },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8 md:px-8 md:py-12">
        {/* Sticky nav */}
        <aside className="sticky top-4 hidden h-fit w-48 shrink-0 md:block">
          <Eyebrow>Раздели</Eyebrow>
          <ul className="mt-3 space-y-2 text-sm">
            {nav.map((n) => (
              <li key={n.id}>
                <a
                  href={`#${n.id}`}
                  className="block text-muted-foreground transition-colors hover:text-score-high"
                >
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </aside>

        <main className="min-w-0 flex-1 space-y-12">
          {/* Intro */}
          <section id="intro" className="scroll-mt-16">
            <Eyebrow>Design system · Изборен монитор</Eyebrow>
            <h1 className="mt-2 font-display text-2xl font-medium tracking-tight md:text-3xl">
              Правила и компоненти
            </h1>
            <div className="mb-6 mt-4 red-bar" aria-hidden />
            <p className="max-w-prose text-md text-muted-foreground">
              Публичен каталог на визуалните решения, използвани в сайта. Живи примери на типография,
              цветове, разредка и компоненти — същите, които UI-ят показва. Ако едно правило не е
              видимо тук, то не е готово.
            </p>
            <p className="max-w-prose text-md text-muted-foreground">
              Пишем на български. Използваме локализирани букви чрез{" "}
              <code className="font-mono text-sm">font-feature-settings: &quot;locl&quot;</code>.
            </p>
          </section>

          <Section id="typography" title="Типография">
            <div className="space-y-4 text-md">
              <p>Три шрифта, всеки със собствена роля — никога не се разменят.</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  <span className="font-display text-foreground">Cormorant Infant</span> — заглавия,
                  словесната марка, h1/h2/h3.
                </li>
                <li>
                  <span className="font-sans text-foreground">Sofia Sans</span> — основен текст, UI,
                  бутони, етикети. Българска работа (Fontfabric / Lasko Dzurovski).
                </li>
                <li>
                  <span className="font-mono text-foreground">Source Code Pro</span> — числа, кодове
                  на секции, идентификатори. Винаги с <code>tabular-nums</code>.
                </li>
              </ul>
            </div>

            <div className="mt-8">
              <Eyebrow>Скала — минор терц (1.2), база 14px</Eyebrow>
              <div className="mt-3 divide-y divide-border border border-border">
                {TYPE_SCALE.map((t) => (
                  <div key={t.name} className="flex items-baseline gap-4 px-3 py-2">
                    <code className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                      {t.name}
                    </code>
                    <code className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {t.px}px
                    </code>
                    <span className="font-display text-foreground" style={{ fontSize: t.px }}>
                      Изборен монитор
                    </span>
                    <span className="ml-auto hidden text-xs text-muted-foreground md:block">
                      {t.use}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <Eyebrow>Български глифи · Cormorant Infant</Eyebrow>
              <p className="font-display text-xl leading-snug">{GLYPH_SPECIMEN}</p>
              <p className="font-display text-xl italic leading-snug">{BG_SPECIMEN}</p>

              <Eyebrow>Sofia Sans</Eyebrow>
              <p className="text-base leading-relaxed">{GLYPH_SPECIMEN}</p>

              <Eyebrow>Source Code Pro</Eyebrow>
              <p className="font-mono text-sm tabular-nums">232800035 · 23.28.00.035 · 0.62</p>
            </div>
          </Section>

          <Section id="headings" title="Заглавия">
            <div className="space-y-6">
              <div>
                <Eyebrow>h1 · страница</Eyebrow>
                <h1 className="mt-1 font-display text-2xl font-medium tracking-tight">
                  Вижте как се гласува във Вашата секция.
                </h1>
                <div className="mt-3 red-bar" aria-hidden />
              </div>

              <div>
                <Eyebrow>h2 · раздел в страница</Eyebrow>
                <h2 className="mt-1 font-display text-2xl font-medium tracking-tight">
                  Какво е Изборен монитор
                </h2>
              </div>

              <div>
                <Eyebrow>h3 · панел / карта</Eyebrow>
                <h3 className="mt-1 font-display text-lg font-medium tracking-tight">
                  Секция 232800035 · Витоша
                </h3>
              </div>
            </div>
          </Section>

          <Section id="eyebrow" title="Eyebrow">
            <p className="max-w-prose text-md text-muted-foreground">
              Не е заглавие — метадатен етикет. 11px, главни букви, tracking{" "}
              <code className="font-mono text-xs">0.12em</code>, muted. Носи структурата на страницата
              по-често, отколкото h2/h3.
            </p>
            <div className="mt-4 space-y-2 border border-border bg-card p-4">
              <Eyebrow>Изберете област</Eyebrow>
              <Eyebrow>За аналитици</Eyebrow>
              <Eyebrow>Протокол</Eyebrow>
            </div>
          </Section>

          <Section id="colors" title="Цветове">
            <div className="space-y-4 text-muted-foreground">
              <p>
                Около 80% неутрални · 15% тонална вариация (две топли бели) · 5% акцент. Червеният е
                единственият UI акцент. Зеленото и триколорът — само като детайл (Fjällräven-стил),
                никога като палитра.
              </p>
            </div>

            <div className="mt-6">
              <Eyebrow>Неутрални</Eyebrow>
              <div className="mt-3">
                <SwatchRow items={NEUTRALS} />
              </div>
            </div>

            <div className="mt-6">
              <Eyebrow>Акценти · флаг</Eyebrow>
              <div className="mt-3">
                <SwatchRow items={ACCENT} />
              </div>
            </div>
          </Section>

          <Section id="scores" title="Цветове за аномалии">
            <p className="max-w-prose text-muted-foreground">
              Трите нива — силно отклонение, средно, в норма. Зеленото{" "}
              <span className="italic">не се използва</span> за „в норма“ — би прозвучало като
              присъда. Статистически сигнал не е доказателство.
            </p>
            <div className="mt-4">
              <SwatchRow items={SCORE} />
            </div>
          </Section>

          <Section id="spacing" title="Разредка — 8pt grid">
            <p className="max-w-prose text-muted-foreground">
              Позволени стойности в px: {SPACING.join(" · ")}. Всичко извън тази скала е off-grid и
              трябва да се премахне в review.
            </p>
            <div className="mt-4 space-y-1">
              {SPACING.map((n) => (
                <div key={n} className="flex items-center gap-3">
                  <code className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {n}px
                  </code>
                  <div className="h-4 bg-foreground" style={{ width: n }} aria-hidden />
                </div>
              ))}
            </div>
          </Section>

          <Section id="rhythm" title="Ритъм">
            <p className="max-w-prose text-md text-muted-foreground">
              Правило на Мюлер-Брокман: около всеки текстов блок оставяй поне колкото неговата
              line-height. Baseline grid е 4px — всички line-height-и и вертикални отстъпи са кратни
              на 4.
            </p>

            <div className="mt-8">
              <Eyebrow>Line-height · кратни на 4</Eyebrow>
              <div className="mt-3 border border-border">
                {LINE_HEIGHT.map((t) => (
                  <div
                    key={t.name}
                    className="flex items-center gap-4 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <code className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                      {t.name}
                    </code>
                    <code className="w-20 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {t.px}/{t.lh}
                    </code>
                    <span
                      className="font-display text-foreground"
                      style={{ fontSize: t.px, lineHeight: `${t.lh}px` }}
                    >
                      Държавата гражданите
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <Eyebrow>Stack rhythm · реални отстъпи</Eyebrow>
              <div className="mt-3 space-y-3">
                {STACK_RHYTHM.map((s) => (
                  <div key={s.between} className="flex items-stretch gap-3">
                    <div className="flex w-48 shrink-0 items-center text-xs text-muted-foreground">
                      {s.between}
                    </div>
                    <div className="flex flex-1 items-center gap-3">
                      <div className="h-6 w-16 border border-border bg-card" />
                      <div
                        className="h-full border-y border-dashed border-brand bg-score-high/10"
                        style={{ width: s.gap }}
                        aria-hidden
                      />
                      <code className="font-mono text-xs tabular-nums text-muted-foreground">
                        {s.gap}px
                      </code>
                      <div className="h-6 w-16 border border-border bg-card" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <Eyebrow>Живо · h3 с параграф и карта</Eyebrow>
              <div className="mt-3 border border-border p-6">
                <h3 className="font-display text-lg font-medium tracking-tight">
                  Секция 232800035
                </h3>
                <p className="mt-2 text-muted-foreground">
                  Всички числа отразяват статистически сигнали, не доказателство. Показва колко
                  необичайни изглеждат резултатите.
                </p>
                <p className="mt-4 text-muted-foreground">
                  Целта е да насочва вниманието към секции, които заслужават проверка, а не да
                  поставя диагнози.
                </p>
                <div className="mt-6 border border-border bg-card p-4">
                  <div className="text-sm">Карта след параграф: 24px отгоре.</div>
                </div>
              </div>
            </div>
          </Section>

          <Section id="padding" title="Вътрешни отстъпи">
            <p className="max-w-prose text-md text-muted-foreground">
              Padding вътре в контейнери. Chip и table cell са изключение от 8pt grid заради
              плътност.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {INNER_PADDING.map((it) => (
                <div key={it.name}>
                  <div className="flex items-center justify-between">
                    <Eyebrow>{it.name}</Eyebrow>
                    <code className="font-mono text-xs tabular-nums text-muted-foreground">
                      {it.p}px
                    </code>
                  </div>
                  <div
                    className="mt-2 border border-border bg-card"
                    style={{ padding: `${it.demo.py}px ${it.demo.px}px` }}
                  >
                    <div className="border border-dashed border-brand/50 bg-score-high/10 px-2 py-1 text-sm">
                      {it.demo.content}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <Eyebrow>Page container · mobile 16 · desktop 32</Eyebrow>
              <div className="mt-3 border border-border bg-card px-4 py-4 md:px-8 md:py-8">
                <div className="border border-dashed border-brand/50 bg-score-high/10 p-4 text-sm">
                  Съдържанието диша повече на desktop. Поведението зависи от breakpoint-а.
                </div>
              </div>
            </div>
          </Section>

          <Section id="radii" title="Радиуси · рамки">
            <div className="flex flex-wrap gap-3">
              {[
                { r: 3.6, name: "sm" },
                { r: 4.8, name: "md" },
                { r: 6, name: "base" },
                { r: 8.4, name: "xl" },
              ].map((x) => (
                <div key={x.name} className="flex flex-col items-center gap-2">
                  <div
                    className="h-16 w-16 border border-border bg-card"
                    style={{ borderRadius: x.r }}
                  />
                  <code className="font-mono text-xs tabular-nums text-muted-foreground">
                    {x.name} · {x.r}px
                  </code>
                </div>
              ))}
            </div>
          </Section>

          <Section id="responsive" title="Responsive">
            <p className="max-w-prose text-md text-muted-foreground">
              Три нива — mobile, tablet, desktop. Tailwind префикси{" "}
              <code className="font-mono">md:</code> (tablet и нагоре) и{" "}
              <code className="font-mono">lg:</code> (desktop). Не използваме{" "}
              <code className="font-mono">sm:</code>, <code className="font-mono">xl:</code>,{" "}
              <code className="font-mono">2xl:</code> без документирана причина.
            </p>

            <div className="mt-8">
              <Eyebrow>Нива</Eyebrow>
              <div className="mt-3 border border-border">
                <div className="grid grid-cols-3 gap-4 border-b border-border bg-muted px-3 py-2 text-xs uppercase tracking-eyebrow text-muted-foreground">
                  <span>tier</span>
                  <span>ширина</span>
                  <span>prefix</span>
                </div>
                {BREAKPOINTS.map((b) => (
                  <div
                    key={b.tier}
                    className="grid grid-cols-3 items-baseline gap-4 border-b border-border px-3 py-2 text-sm last:border-b-0"
                  >
                    <span className="font-medium">{b.tier}</span>
                    <code className="font-mono text-xs tabular-nums text-muted-foreground">
                      {b.range}
                    </code>
                    <code className="font-mono text-xs text-muted-foreground">{b.prefix}</code>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8">
              <Eyebrow>Type scale · mobile · tablet · desktop</Eyebrow>
              <div className="mt-3 border border-border">
                <div className="grid grid-cols-[6rem_1fr_1fr_1fr] gap-4 border-b border-border bg-muted px-3 py-2 text-xs uppercase tracking-eyebrow text-muted-foreground">
                  <span>step</span>
                  <span>mobile</span>
                  <span>tablet</span>
                  <span>desktop</span>
                </div>
                {RESPONSIVE_TYPE.map((r) => {
                  const bodyLike = r.step.includes("body") || r.step === "eyebrow";
                  return (
                    <div
                      key={r.step}
                      className="grid grid-cols-[6rem_1fr_1fr_1fr] items-baseline gap-4 border-b border-border px-3 py-3 last:border-b-0"
                    >
                      <code className="font-mono text-xs text-muted-foreground">{r.step}</code>
                      <span
                        className={bodyLike ? "" : "font-display"}
                        style={{ fontSize: r.mobile }}
                      >
                        Изборен монитор
                      </span>
                      <span
                        className={bodyLike ? "" : "font-display"}
                        style={{ fontSize: r.tablet }}
                      >
                        Изборен монитор
                      </span>
                      <span
                        className={bodyLike ? "" : "font-display"}
                        style={{ fontSize: r.desktop }}
                      >
                        Изборен монитор
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Body и eyebrow не мърдат никога. Заглавията скачат една стъпка само на desktop.
              </p>
            </div>

            <div className="mt-8">
              <Eyebrow>Layout shifts</Eyebrow>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <div className="border border-border p-4">
                  <div className="eyebrow mb-3">mobile · &lt; 768px</div>
                  <div className="relative h-32 border border-border bg-muted">
                    <div className="absolute inset-2 border border-brand bg-score-high/10" />
                    <div className="absolute right-3 top-3 text-xs text-score-high">×</div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Full-screen overlay с × за затваряне
                  </div>
                </div>
                <div className="border border-border p-4">
                  <div className="eyebrow mb-3">tablet · 768–1023px</div>
                  <div className="relative h-32 border border-border bg-muted">
                    <div className="absolute inset-2 border border-brand bg-score-high/10" />
                    <div className="absolute right-3 top-3 text-xs text-score-high">×</div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Още overlay — повече въздух в padding
                  </div>
                </div>
                <div className="border border-border p-4">
                  <div className="eyebrow mb-3">desktop · ≥ 1024px</div>
                  <div className="flex h-32 gap-2">
                    <div className="flex-1 border border-border bg-muted" />
                    <div className="w-24 border border-brand bg-score-high/10" />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Sidebar като rail · 420px фиксиран
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8">
              <Eyebrow>Touch targets</Eyebrow>
              <p className="mt-2 max-w-prose text-muted-foreground">
                Всеки интерактивен елемент ≥ 40px в най-малкото си измерение на mobile и tablet. Chip
                от 22px на desktop получава 10px hit-area или става бутон 40px под{" "}
                <code className="font-mono">lg:</code>.
              </p>
              <div className="mt-4 flex items-end gap-6">
                <div className="flex flex-col items-center gap-2">
                  <div
                    className="flex items-center rounded bg-score-high/10 px-1.5 font-mono text-xs font-semibold text-score-high"
                    style={{ height: 22 }}
                  >
                    0.62
                  </div>
                  <code className="font-mono text-xs text-muted-foreground">22px · desktop</code>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div
                    className="flex h-10 items-center rounded bg-score-high/10 px-3 font-mono text-sm font-semibold text-score-high"
                  >
                    0.62
                  </div>
                  <code className="font-mono text-xs text-muted-foreground">40px · mobile</code>
                </div>
              </div>
            </div>
          </Section>

          <Section id="components" title="Примитиви">
            <div className="space-y-6">
              <div>
                <Eyebrow>Anomaly chip</Eyebrow>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded bg-score-high/10 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-score-high">
                    0.78
                  </span>
                  <span className="rounded bg-score-medium/10 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-score-medium">
                    0.42
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-score-low">
                    0.12
                  </span>
                </div>
              </div>

              <div>
                <Eyebrow>Tags</Eyebrow>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded bg-score-high/10 px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-score-high">
                    ×3
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-foreground">
                    Подвижна
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-foreground">
                    Болница
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-foreground">
                    Чужбина
                  </span>
                </div>
              </div>

              <div>
                <Eyebrow>Card</Eyebrow>
                <div className="mt-3 max-w-md border border-border bg-card p-3">
                  <h3 className="font-display text-lg font-medium tracking-tight">
                    Секция 232800035
                  </h3>
                  <p className="mt-1 text-muted-foreground">
                    ул. „Христо Ботев&quot; 12, София 1000
                  </p>
                </div>
              </div>
            </div>
          </Section>

          <Section id="app-components" title="В приложението">
            <p className="max-w-prose text-md text-muted-foreground">
              Статични макети на реалните компоненти — не живи, няма state. Целта е да се види как
              правилата се прилагат в контекст. Ако нещо тук не съвпада с prod, prod е това, което
              трябва да се промени.
            </p>

            {/* Navbar */}
            <div className="mt-8">
              <Eyebrow>Nav bar · 44px</Eyebrow>
              <div className="mt-3 overflow-hidden border border-border bg-background">
                <nav className="flex h-11 items-center gap-2 border-b border-border px-4">
                  <span className="font-display text-lg font-medium tracking-tight">
                    Изборен монитор
                  </span>
                  <span className="h-4 w-px bg-border" />
                  <span className="text-xs font-medium text-foreground">
                    Парл. 27.10.2024 ▾
                  </span>
                  <div className="ml-2 flex items-center gap-0.5">
                    <span className="rounded bg-foreground px-3 py-1.5 text-xs font-medium uppercase tracking-eyebrow text-background">
                      Резултати
                    </span>
                    <span className="px-3 py-1.5 text-xs font-medium uppercase tracking-eyebrow text-muted-foreground">
                      Секции
                    </span>
                    <span className="px-3 py-1.5 text-xs font-medium uppercase tracking-eyebrow text-muted-foreground">
                      Таблица
                    </span>
                    <span className="px-3 py-1.5 text-xs font-medium uppercase tracking-eyebrow text-muted-foreground">
                      Системни
                    </span>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <div className="w-48 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
                      Търсете секция...
                    </div>
                    <span className="rounded border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground">
                      ↗ Сподели
                    </span>
                  </div>
                </nav>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Активният таб е инвертиран (dark pill) — единственият силен UI акцент след червеното.
              </p>
            </div>

            {/* Section panel */}
            <div className="mt-8">
              <Eyebrow>Section panel · 420px desktop / full-screen mobile</Eyebrow>
              <div className="mt-3 grid gap-4 md:grid-cols-[420px_1fr]">
                <div
                  className="flex flex-col overflow-hidden border border-border bg-background shadow-sm"
                  style={{ maxHeight: 560 }}
                >
                  <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                    <span className="text-muted-foreground">✕</span>
                    <span className="truncate text-sm font-medium">Секция 232800035</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6">
                    <h3 className="font-display text-lg font-medium tracking-tight">
                      Витоша · район „Възраждане&quot;
                    </h3>
                    <p className="mt-2 text-muted-foreground">
                      <span className="font-mono tabular-nums">232800035</span> · ул. „Христо Ботев&quot;
                      12, София 1000
                    </p>
                    <div className="mt-4 red-bar" aria-hidden />

                    <div className="mt-6">
                      <Eyebrow>Резултати</Eyebrow>
                      <div className="mt-2 space-y-1">
                        {[
                          { name: "ПП-ДБ", pct: 34.2, w: "68%" },
                          { name: "ГЕРБ-СДС", pct: 22.4, w: "45%" },
                          { name: "ДПС", pct: 15.1, w: "30%" },
                          { name: "Възраждане", pct: 8.9, w: "18%" },
                        ].map((p) => (
                          <div key={p.name} className="flex items-center gap-2 text-sm">
                            <span className="w-24 truncate">{p.name}</span>
                            <div className="flex-1">
                              <div className="h-2 bg-foreground" style={{ width: p.w }} />
                            </div>
                            <span className="w-12 text-right font-mono tabular-nums">
                              {p.pct.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-6">
                      <Eyebrow>Аномалии</Eyebrow>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded bg-score-high/10 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-score-high">
                          0.78
                        </span>
                        <span className="rounded bg-score-high/10 px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-score-high">
                          Протокол
                        </span>
                        <span className="rounded bg-score-medium/10 px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-score-medium">
                          Съседи
                        </span>
                      </div>
                      <p className="mt-2 text-sm">
                        Силно отклонение от нормалното — заслужава проверка.
                      </p>
                    </div>

                    <div className="mt-6">
                      <Eyebrow>Протокол</Eyebrow>
                      <a className="mt-1 inline-block text-sm text-foreground underline underline-offset-2 hover:text-score-high">
                        Скан от ЦИК ↗
                      </a>
                    </div>

                    <div className="mt-6">
                      <a className="text-sm text-foreground underline underline-offset-2 hover:text-score-high">
                        История на секцията →
                      </a>
                    </div>
                  </div>
                </div>
                <div className="hidden rounded-none border border-dashed border-border p-4 text-xs text-muted-foreground md:block">
                  <p>
                    Ширина: <strong className="text-foreground">420px</strong> (<code className="font-mono">md:w-sidebar</code>) на desktop, full-screen на mobile.
                  </p>
                  <p className="mt-3">
                    Header height — 40px на desktop (<code className="font-mono">h-10</code>), 48px
                    на mobile (<code className="font-mono">h-12</code>).
                  </p>
                  <p className="mt-3">
                    Ритъм между блоковете: <code className="font-mono">mt-6</code> (24px) между
                    eyebrow-групите. Съдържание след eyebrow:{" "}
                    <code className="font-mono">mt-2</code> (8px).
                  </p>
                </div>
              </div>
            </div>

            {/* Map filter panel */}
            <div className="mt-8">
              <Eyebrow>Map filter · floating top-left</Eyebrow>
              <div
                className="mt-3 inline-block border border-border bg-card shadow-sm"
                style={{ minWidth: 280 }}
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-xs font-medium uppercase tracking-eyebrow text-muted-foreground">
                    Филтър
                  </span>
                  <span className="text-xs text-muted-foreground">↓</span>
                </div>
                <div className="space-y-3 p-3">
                  <div>
                    <Eyebrow>Методология</Eyebrow>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {["Обобщена", "Протокол", "Съседи", "Бенфорд", "АКФ"].map((m, i) => (
                        <span
                          key={m}
                          className={`rounded border px-2 py-1 text-xs ${
                            i === 0
                              ? "border-foreground bg-foreground text-background"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Eyebrow>Тип секция</Eyebrow>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {[
                        { l: "Обикновени", on: true },
                        { l: "Подвижна", on: true },
                        { l: "Болница", on: false },
                        { l: "Затвор", on: false },
                        { l: "Чужбина", on: false },
                      ].map((t) => (
                        <span
                          key={t.l}
                          className={`rounded px-2 py-1 text-2xs font-medium uppercase tracking-wide ${
                            t.on ? "bg-muted text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {t.l}
                        </span>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="inline-block h-4 w-4 border border-foreground bg-foreground" />
                    <span>Само с аномалии</span>
                  </label>
                  <div className="border-t border-border pt-2 font-mono text-xs tabular-nums text-muted-foreground">
                    1 247 / 11 893 секции
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Методология и тип секция — еднакъв rounded chip, dark pill активно състояние,
                статус линия в mono.
              </p>
            </div>

            {/* Sections table */}
            <div className="mt-8">
              <Eyebrow>Sections table · dense</Eyebrow>
              <div className="mt-3 overflow-hidden border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-background">
                      {[
                        { label: "Секция", sort: "↕" },
                        { label: "Населено място", sort: "↕" },
                        { label: "Обобщено", sort: "↓" },
                        { label: "Протокол", sort: "↕" },
                        { label: "Съседи", sort: "↕" },
                        { label: "Активност", sort: "" },
                      ].map((h) => (
                        <th
                          key={h.label}
                          className="px-2 py-2 text-left text-xs font-medium uppercase tracking-eyebrow text-muted-foreground"
                        >
                          {h.label}{" "}
                          {h.sort && <span className="text-foreground">{h.sort}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {
                        code: "232800035",
                        name: "София · Възраждане",
                        combined: 0.78,
                        protocol: 0.9,
                        peer: 0.62,
                      },
                      {
                        code: "191200118",
                        name: "Пловдив · Тракия",
                        combined: 0.54,
                        protocol: 0.31,
                        peer: 0.71,
                      },
                      {
                        code: "030400042",
                        name: "Бургас · Меден рудник",
                        combined: 0.29,
                        protocol: 0.14,
                        peer: 0.38,
                      },
                      {
                        code: "170600201",
                        name: "Варна · Аспарухово",
                        combined: 0.11,
                        protocol: 0.05,
                        peer: 0.12,
                      },
                    ].map((r, i) => {
                      const chip = (v: number) => {
                        if (v >= 0.6)
                          return (
                            <span className="rounded bg-score-high/10 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-score-high">
                              {v.toFixed(2)}
                            </span>
                          );
                        if (v >= 0.3)
                          return (
                            <span className="rounded bg-score-medium/10 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-score-medium">
                              {v.toFixed(2)}
                            </span>
                          );
                        return (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-score-low">
                            {v.toFixed(2)}
                          </span>
                        );
                      };
                      return (
                        <tr key={r.code} className={i > 0 ? "border-t border-border" : ""}>
                          <td className="px-2 py-2 font-mono text-xs tabular-nums">{r.code}</td>
                          <td className="px-2 py-2">{r.name}</td>
                          <td className="px-2 py-2">{chip(r.combined)}</td>
                          <td className="px-2 py-2">{chip(r.protocol)}</td>
                          <td className="px-2 py-2">{chip(r.peer)}</td>
                          <td className="px-2 py-2">
                            <svg width={48} height={20} className="align-middle">
                              <polyline
                                points="1,16 10,14 20,10 30,12 40,7 47,6"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={1.2}
                                className="text-muted-foreground/50"
                              />
                              <circle cx={47} cy={6} r={2} className="fill-foreground" />
                            </svg>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Row height 32px (<code className="font-mono">py-2 px-2</code>) — exception to 8pt
                grid заради density.
              </p>
            </div>

            {/* Map tooltip */}
            <div className="mt-8">
              <Eyebrow>Map tooltip</Eyebrow>
              <div
                className="mt-3 inline-block border border-border bg-card p-3 shadow-sm"
                style={{ minWidth: 200 }}
              >
                <div className="font-display text-base font-medium">
                  Секция 232800035
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">София · Възраждане</div>
                <div className="mt-2 space-y-0.5 font-mono text-xs tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Активност</span>
                    <span>62%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Обобщено</span>
                    <span className="text-score-high">0.78</span>
                  </div>
                </div>
                <a className="mt-2 block text-xs text-foreground underline underline-offset-2 hover:text-score-high">
                  Отвори секция →
                </a>
              </div>
            </div>

            {/* Score badge variants */}
            <div className="mt-8">
              <Eyebrow>Score badge · sm / lg</Eyebrow>
              <div className="mt-3 flex items-center gap-3">
                <span className="rounded bg-score-high/10 px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-score-high">
                  0.78
                </span>
                <span className="rounded bg-score-high/10 px-2 py-0.5 font-mono text-sm font-semibold tabular-nums text-score-high">
                  0.78
                </span>
                <code className="font-mono text-xs text-muted-foreground">
                  sm — таблица, inline · lg — section-detail strip
                </code>
              </div>
            </div>
          </Section>

          <Section id="known-gaps" title="Над какво работим">
            <p className="max-w-prose text-muted-foreground">
              Честен списък на това, което още не е наред. Заменя „Coming soon“ с видимост.
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
              {KNOWN_GAPS.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </Section>

          <div className="border-t border-border pt-6 text-xs text-muted-foreground">
            Изходният код на правилата живее в{" "}
            <code className="font-mono">.internal/design-rules.md</code> (вътрешен). Тази страница е
            публичната им проверка.
          </div>
        </main>
      </div>
    </div>
  );
}
