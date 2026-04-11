/**
 * Collapsible methodology block. Plain-Bulgarian explanation of every
 * statistical signal the app surfaces, framed as "we describe, we don't
 * judge". Uses native <details>/<summary>: no state, no JS required,
 * keyboard-accessible for free.
 *
 * Two visual variants:
 *   - "card" (default): bordered panel with background. Used on
 *     section-detail where the explainer is a sibling of other cards.
 *   - "inline": uppercase small-caps toggle link that expands into a
 *     bordered body. Used in sections-table header where vertical space
 *     is at a premium.
 */
export default function MethodologyExplainer({
  className,
  variant = "card",
}: {
  className?: string;
  variant?: "card" | "inline";
}) {
  if (variant === "inline") {
    return (
      <details className={`group ${className ?? ""}`}>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span>Какво означават числата</span>
          <span className="transition-transform group-open:rotate-180">▼</span>
        </summary>
        <div className="mt-3 max-w-3xl space-y-4 rounded border border-border bg-card p-4 text-[13px] leading-relaxed text-muted-foreground">
          <MethodologyBody />
        </div>
      </details>
    );
  }

  return (
    <details
      className={`group rounded border border-border bg-card ${className ?? ""}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/40 [&::-webkit-details-marker]:hidden">
        <span>Какво означават тези числа?</span>
        <span className="text-[11px] text-muted-foreground transition-transform group-open:rotate-180">
          ▼
        </span>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4 text-[13px] leading-relaxed text-muted-foreground">
        <MethodologyBody />
      </div>
    </details>
  );
}

function MethodologyBody() {
  return (
    <>
      <Item term="Риск">
        Обобщен статистически сигнал, съчетаващ четирите проверки по-долу.
        Стойност над <span className="font-mono">0.3</span> е в зоната на
        отклонение, а над <span className="font-mono">0.6</span> означава
        силно отклонение от нормата. Числото показва колко необичайни
        изглеждат резултатите, не означава доказано нарушение.
      </Item>
      <Item term="Бенфорд">
        Когато хора броят реални неща, първите цифри на числата следват
        известен модел: повече числа започват с 1 и 2, по-малко с 8 и 9.
        Това е законът на Бенфорд. Когато разпределението в дадена секция
        не съвпада с този модел, това е сигнал, че числата може да не идват
        от естествен процес на преброяване.
      </Item>
      <Item term="Сравнение (peer deviation)">
        Сравняваме резултатите в тази секция със съседните секции в същото
        населено място. Хората в съседни секции имат сходен профил и
        обикновено гласуват подобно. Когато една секция рязко се отличава
        от съседите си, това е сигнал, който заслужава проверка.
      </Item>
      <Item term="АКФ (авто-корелация)">
        Търси необичайни пространствени модели между съседни секции:
        прекалено повтарящи се резултати, внезапни промени в цели групи
        секции или подозрителни редувания. В естествени данни такива модели
        са редки; когато се появяват системно, това е сигнал.
      </Item>
      <Item term="Активност">
        Дял на гласувалите спрямо списъчния състав на секцията. Стойност над{" "}
        <span className="font-mono">100%</span> е физически невъзможна и
        означава грешка в протокола или в обработката на данните.
      </Item>
      <Item term="Проблеми">
        Аритметични грешки в протокола (например общо гласували ≠ валидни +
        невалидни), несъответствия между полетата и формални нарушения при
        попълването.
      </Item>
      <p className="text-[12px] italic text-muted-foreground/80">
        Всички числа отразяват статистически сигнали, не доказателство.
        Целта е да насочват вниманието към секции, които заслужават проверка,
        а не да поставят диагнози.
      </p>
    </>
  );
}

function Item({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground">
        {term}
      </div>
      <div>{children}</div>
    </div>
  );
}
