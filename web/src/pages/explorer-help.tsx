import { ExternalLink, Download, MessageSquare, Database, Sparkles, FolderOpen } from "lucide-react";

const GITHUB_URL = "https://github.com/datasciencesociety/elections";
const GITHUB_BRANCH_URL = `${GITHUB_URL}/tree/feature/web-visualize`;
const ZIP_URL = `${GITHUB_URL}/archive/refs/heads/feature/web-visualize.zip`;
const DB_URL = `${GITHUB_URL}/releases/latest/download/elections.db`;
const CLAUDE_DESKTOP_URL = "https://claude.ai/download";

const EXAMPLE_PROMPTS = [
  "Покажи ми резултатите от последните парламентарни избори на карта по общини.",
  "Сравни ГЕРБ и ДПС в последните 5 парламентарни избора.",
  "Къде има най-висок риск от аномалии в изборите от октомври 2024?",
  "Каква е избирателната активност по области?",
  "Покажи топ 10 общини с най-висока активност за изборите на 09.06.2024.",
];

const SKILLS = [
  { name: "Карта по общини", desc: "Карта на България, оцветена по водеща партия във всяка община" },
  { name: "Резултати", desc: "Графика с активност и разпределение на гласовете" },
  { name: "Аномалии", desc: "Секции с необичайни статистически показатели" },
  { name: "Сравнение", desc: "Как се променят резултатите на партия през няколко избора" },
  { name: "Активност", desc: "Избирателна активност по области или общини" },
];

export default function ExplorerHelp() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        {/* Hero */}
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
          Изследвай изборните данни с изкуствен интелект
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-xl">
          Базата данни с всички избори (2021–2024) е достъпна за свободен анализ.
          Питаш на български, получаваш интерактивни карти, графики и таблици
          директно от данните. Не е нужно да програмираш.
        </p>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-xl">
          Използваме{" "}
          <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" className="text-[#ce463c] hover:underline">
            Claude
            <ExternalLink size={10} className="mb-0.5 ml-0.5 inline" />
          </a>{" "}
          на Anthropic. Claude е AI асистент, който може да чете базата данни, да пише заявки
          и да генерира визуализации по ваше описание. Приложението му за десктоп (Claude Desktop)
          има режим Cowork, в който работи директно с файлове на компютъра ви.
        </p>

        {/* Screenshot */}
        <div className="mt-6 overflow-hidden rounded-lg border border-border shadow-sm">
          <img
            src="/cowork-screenshot.png"
            alt="Claude Cowork, карта по общини с резултати от парламентарни избори"
            className="w-full"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Пример: карта по общини с резултатите от парламентарните избори на 27.10.2024
        </p>

        {/* Steps */}
        <h2 className="mt-10 font-display text-lg font-semibold">Как да започнете</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Три стъпки. Всичко става с кликване, не е нужен терминал или програмиране.
        </p>

        <ol className="mt-4 space-y-6">
          <Step
            n={1}
            icon={<Download size={16} />}
            title="Свалете проекта"
          >
            <p className="text-sm text-muted-foreground">
              Кликнете бутона по-долу. Ще се свали ZIP файл. Разархивирайте го на удобно място
              (например на десктопа).
            </p>
            <a
              href={ZIP_URL}
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <Download size={16} />
              Свали проекта (.zip)
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              След разархивиране ще имате папка <strong>elections-feature-web-visualize</strong>.
              Вътре намерете папката <strong>elections-explorer</strong>.
            </p>
          </Step>

          <Step
            n={2}
            icon={<Database size={16} />}
            title="Свалете базата данни"
          >
            <p className="text-sm text-muted-foreground">
              Базата е голям файл (~1.3 GB) и се сваля отделно. Кликнете бутона и изчакайте
              изтеглянето. Може да отнеме няколко минути.
            </p>
            <a
              href={DB_URL}
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <Database size={16} />
              Свали elections.db (1.3 GB)
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              След сваляне преместете файла <strong>elections.db</strong> в папката{" "}
              <strong>elections-explorer</strong> от стъпка 1.
            </p>
          </Step>

          <Step
            n={3}
            icon={<Sparkles size={16} />}
            title="Отворете в Claude Desktop"
          >
            <p className="text-sm text-muted-foreground">
              Ако нямате Claude Desktop,{" "}
              <a href={CLAUDE_DESKTOP_URL} target="_blank" rel="noopener noreferrer" className="text-[#ce463c] hover:underline">
                свалете го безплатно оттук
                <ExternalLink size={10} className="mb-0.5 ml-0.5 inline" />
              </a>.
            </p>
            <div className="mt-3 space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">a</span>
                <span>Отворете Claude Desktop</span>
              </div>
              <div className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">б</span>
                <span>Изберете <strong>Cowork</strong> от горните табове</span>
              </div>
              <div className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">в</span>
                <span>
                  Кликнете <FolderOpen size={13} className="mx-0.5 inline" />{" "}
                  <strong>Open folder</strong> и изберете папката <strong>elections-explorer</strong>
                </span>
              </div>
              <div className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">г</span>
                <span>Питайте каквото искате на български. Готово!</span>
              </div>
            </div>
          </Step>
        </ol>

        {/* Example prompts */}
        <h2 className="mt-10 font-display text-lg font-semibold">
          <MessageSquare size={16} className="mr-1.5 inline text-muted-foreground" />
          Примерни въпроси
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Копирайте директно или питайте със свои думи. Claude разбира контекста.
        </p>
        <ul className="mt-3 space-y-2">
          {EXAMPLE_PROMPTS.map((p) => (
            <li key={p} className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm italic text-foreground">
              {p}
            </li>
          ))}
        </ul>

        {/* Skills table */}
        <h2 className="mt-10 font-display text-lg font-semibold">Какво може да прави</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Claude автоматично разбира какво питате и генерира подходящата визуализация.
        </p>
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Тип</th>
                <th className="px-3 py-2 font-medium">Описание</th>
              </tr>
            </thead>
            <tbody>
              {SKILLS.map((s) => (
                <tr key={s.name} className="border-b border-border/50 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Why SQLite */}
        <h2 className="mt-10 font-display text-lg font-semibold">Защо SQLite</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Официалните данни от ЦИК се публикуват като CSV файлове. Можете да проверите
          отделна секция, но за да търсите, сравнявате или агрегирате резултати, данните
          трябва да бъдат в база. Освен това всеки избор идва в малко по-различен формат.
          Написахме конвертори, които привеждат всичките 18 избора в единна структура.
        </p>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Избрахме{" "}
          <a href="https://sqlite.org" target="_blank" rel="noopener noreferrer" className="text-[#ce463c] hover:underline">
            SQLite
            <ExternalLink size={10} className="mb-0.5 ml-0.5 inline" />
          </a>{" "}
          защото е един файл, не изисква сървър и работи навсякъде.
          Ако знаете SQL, можете да заявявате директно. Ако не знаете, Claude го пише вместо вас.
        </p>

        {/* SQLite requirement */}
        <div className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Нужен е SQLite на компютъра ви</p>
          <p className="mt-1">
            Claude използва <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">sqlite3</code> за
            да чете базата данни.
          </p>
          <ul className="mt-2 space-y-1.5 text-xs">
            <li>
              <strong>Mac:</strong> Вече е инсталиран — не трябва да правите нищо.
            </li>
            <li>
              <strong>Windows:</strong> Свалете <strong>sqlite-tools</strong> от{" "}
              <a href="https://sqlite.org/download.html" target="_blank" rel="noopener noreferrer" className="text-[#ce463c] hover:underline">
                sqlite.org/download.html
                <ExternalLink size={10} className="mb-0.5 ml-0.5 inline" />
              </a>{" "}
              (секция "Precompiled Binaries for Windows"). Разархивирайте и сложете{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">sqlite3.exe</code> в
              папката <strong>elections-explorer</strong>.
            </li>
            <li>
              <strong>Linux:</strong> Знаете какво да правите.
            </li>
          </ul>
        </div>

        {/* What's in the DB */}
        <h2 className="mt-10 font-display text-lg font-semibold">Какво съдържа базата</h2>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          <li>18 избора (2021–2024): парламентарни, президентски, европейски, местни</li>
          <li>Резултати на ниво секция: партии, гласове (хартия + машина), протоколи</li>
          <li>Географска привързаност: община, област, РИК, населено място, GPS координати</li>
          <li>Статистически оценки за аномалии</li>
          <li>Полигони за карти: общини, области и РИК-ове</li>
        </ul>

        {/* Data source */}
        <div className="mt-10 rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          Всички данни са от{" "}
          <a href="https://www.cik.bg" target="_blank" rel="noopener noreferrer" className="text-[#ce463c] hover:underline">
            Централната избирателна комисия (ЦИК)
            <ExternalLink size={10} className="mb-0.5 ml-0.5 inline" />
          </a>.
          Сумите по партия за всички национални избори са валидирани да съвпадат с официалните резултати.
          Изходният код е{" "}
          <a href={GITHUB_BRANCH_URL} target="_blank" rel="noopener noreferrer" className="text-[#ce463c] hover:underline">
            отворен
            <ExternalLink size={10} className="mb-0.5 ml-0.5 inline" />
          </a>.
        </div>

        <div className="h-8" />
      </div>
    </div>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon} {title}
        </h3>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  );
}
