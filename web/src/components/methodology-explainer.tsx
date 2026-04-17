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
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span>Какво означават числата</span>
          <span className="transition-transform group-open:rotate-180">▼</span>
        </summary>
        <div className="mt-3 max-w-3xl space-y-4 rounded border border-border bg-card p-4 text-muted-foreground">
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
        <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">
          ▼
        </span>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4 text-muted-foreground">
        <MethodologyBody />
      </div>
    </details>
  );
}

function MethodologyBody() {
  return (
    <>
      <Item term="Нарушения в протокола">
        Аритметични грешки в протокола (например общо гласували ≠ валидни +
        невалидни), несъответствия между полетата и формални нарушения при
        попълването. Това са обективни грешки — числата в протокола не се
        събират правилно.
      </Item>
      <Item term="Обобщена оценка">
        Среднопретеглена стойност от трите статистически проверки по-долу
        (Бенфорд, сравнение, пространствени модели).
        Стойност над <span className="font-mono">0.3</span> е в зоната на
        отклонение, а над <span className="font-mono">0.6</span> означава
        силно отклонение от нормата. Показва колко необичайни изглеждат
        резултатите, не означава доказано нарушение.
      </Item>
      <Item term="Бенфорд">
        Когато хора броят реални неща, първите цифри на числата следват
        известен модел: повече числа започват с 1 и 2, по-малко с 8 и 9.
        Това е{" "}
        <a
          href="https://bg.wikipedia.org/wiki/%D0%97%D0%B0%D0%BA%D0%BE%D0%BD_%D0%BD%D0%B0_%D0%91%D0%B5%D0%BD%D1%84%D0%BE%D1%80%D0%B4"
          target="_blank"
          rel="noopener noreferrer"
          className="text-score-high hover:underline"
        >
          законът на Бенфорд
        </a>
        . Когато разпределението в дадена секция не съвпада с този модел,
        това е сигнал, че числата може да не идват от естествен процес на
        преброяване.
      </Item>
      <Item term="Сравнение със съседи">
        Сравняваме резултатите в тази секция със съседните секции в същото
        населено място. Хората в съседни секции имат сходен профил и
        обикновено гласуват подобно. Когато една секция рязко се отличава
        от съседите си, това е сигнал, който заслужава проверка.
      </Item>
      <Item term="АКФ (Антикорупционен фонд)">
        Методология на{" "}
        <a
          href="https://acf.bg/wp-content/uploads/2021/05/rezultati_izbori_BGweb.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="text-score-high hover:underline"
        >
          Антикорупционен фонд
        </a>{" "}
        за идентифициране на контролиран и купен вот. Включва три проверки:
        (1) нетипично висока активност или резултат на водещата партия спрямо
        общината, (2) рязка промяна в активността между два поредни избора,
        (3) рязка промяна в политическите пристрастия между два поредни
        избора. Маркерът ×3 означава, че и трите проверки са задействани
        едновременно.
      </Item>
      <Item term="Активност">
        Дял на гласувалите спрямо списъчния състав на секцията. Стойност над{" "}
        <span className="font-mono">100%</span> е физически невъзможна и
        означава грешка в протокола или в обработката на данните.
      </Item>
      <p className="text-sm italic text-muted-foreground/80">
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
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-foreground">
        {term}
      </div>
      <div>{children}</div>
    </div>
  );
}
