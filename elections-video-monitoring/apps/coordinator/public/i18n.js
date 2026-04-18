const TRANSLATIONS = {
  en: {
    'header.title': 'Election Stream Monitor',
    'session.connecting': 'connecting…',
    'streams.label': 'Streams:',
    'loading.connecting': 'Connecting to coordinator…',
    'inspect.placeholder': '← select a stream to inspect',
    'overlay.title': 'Stream Monitor',
    'overlay.body': 'Your browser needs to autoplay muted video streams. Click Start to begin monitoring.',
    'overlay.start': 'Start Monitoring',
    'status.initializing': 'Initializing',
    'status.loading': 'Loading',
    'status.ok': 'OK',
    'status.covered': 'COVERED',
    'status.frozen': 'FROZEN',
    'status.dark': 'DARK / MISSING',
    'status.error': 'Error',
    'session.resumed': 'Resumed',
    'session.new': 'Session',
    'monitoring.count': 'Monitoring {n} streams',
    'connect.failed': 'Failed to connect. Retrying in 10s…',
    'reconnecting': 'Reconnecting…',
    'last.report': 'Last report:',
    'admin.page.title': 'Election Monitor — Admin',
    'admin.header': 'Election Stream Monitor — Admin',
    'meta.volunteers': 'Active volunteers:',
    'meta.flagged': 'Flagged streams:',
    'meta.updated': 'Updated:',
    'coverage.title': 'Coverage',
    'stat.total': 'Total',
    'stat.enabled': 'Enabled',
    'stat.covered': 'Covered',
    'stat.volunteers': 'Volunteers',
    'upload.title': 'Add / Update Sections',
    'upload.btn': 'Upload',
    'upload.file': 'Choose file',
    'upload.reset': 'Reset all',
    'sections.title': 'Sections ({n})',
    'sections.filter.placeholder': 'Filter sections…',
    'flagged.title': 'Flagged Streams',
    'table.label': 'Label',
    'table.url': 'URL',
    'table.flag': 'Flag',
    'table.firstseen': 'First seen',
    'table.duration': 'Duration',
    'table.reports': 'Reports',
    'flagged.none': 'No flagged streams',
    'upload.paste.first': 'Paste JSON first',
    'upload.invalid.json': 'Invalid JSON:',
    'upload.not.array': 'Expected a JSON array',
    'upload.uploading': 'Uploading…',
    'upload.error': 'Error:',
    'upload.noop': 'No changes (all sections already up to date)',
    'upload.network.error': 'Network error:',
    'upload.reset.done': 'Reset: {n} streams loaded',
    'confirm.reset': 'This will DELETE all streams, sessions, and reports. Are you sure?',
    'confirm.empty': 'No JSON provided — this will wipe everything with nothing to replace it. Continue?',
    'toggle.disable': 'Disable',
    'toggle.enable': 'Enable',
    'refresh.auto': 'auto-refresh every 15s',
    'refresh.error': 'Connection error',
    'time.sec.ago': '{n}s ago',
    'time.min.ago': '{n}m ago',
    'time.hour.ago': '{n}h {m}m ago',
  },
  bg: {
    'header.title': 'Монитор на изборни потоци',
    'session.connecting': 'свързване…',
    'streams.label': 'Потоци:',
    'loading.connecting': 'Свързване с координатора…',
    'inspect.placeholder': '← изберете поток за преглед',
    'overlay.title': 'Монитор на потоци',
    'overlay.body': 'Браузърът ви трябва да пусне автоматично потоците без звук. Натиснете Старт, за да започнете наблюдението.',
    'overlay.start': 'Стартирай наблюдение',
    'status.initializing': 'Инициализиране',
    'status.loading': 'Зареждане',
    'status.ok': 'OK',
    'status.covered': 'ПОКРИТ',
    'status.frozen': 'ЗАМРАЗЕН',
    'status.dark': 'ТЪМЕН / ЛИПСВАЩ',
    'status.error': 'Грешка',
    'session.resumed': 'Възобновена',
    'session.new': 'Сесия',
    'monitoring.count': 'Наблюдават се {n} потока',
    'connect.failed': 'Неуспешна връзка. Повторен опит след 10s…',
    'reconnecting': 'Повторно свързване…',
    'last.report': 'Последен доклад:',
    'admin.page.title': 'Изборен монитор — Администратор',
    'admin.header': 'Монитор на изборни потоци — Администратор',
    'meta.volunteers': 'Активни доброволци:',
    'meta.flagged': 'Маркирани потоци:',
    'meta.updated': 'Обновено:',
    'coverage.title': 'Покритие',
    'stat.total': 'Общо',
    'stat.enabled': 'Активни',
    'stat.covered': 'Покрити',
    'stat.volunteers': 'Доброволци',
    'upload.title': 'Добавяне / Обновяване на секции',
    'upload.btn': 'Качване',
    'upload.file': 'Избор на файл',
    'upload.reset': 'Нулиране',
    'sections.title': 'Секции ({n})',
    'sections.filter.placeholder': 'Филтриране на секции…',
    'flagged.title': 'Маркирани потоци',
    'table.label': 'Етикет',
    'table.url': 'URL',
    'table.flag': 'Маркировка',
    'table.firstseen': 'Първо засечено',
    'table.duration': 'Продължителност',
    'table.reports': 'Доклади',
    'flagged.none': 'Няма маркирани потоци',
    'upload.paste.first': 'Поставете JSON',
    'upload.invalid.json': 'Невалиден JSON:',
    'upload.not.array': 'Очаква се JSON масив',
    'upload.uploading': 'Качване…',
    'upload.error': 'Грешка:',
    'upload.noop': 'Няма промени (всички секции са актуални)',
    'upload.network.error': 'Мрежова грешка:',
    'upload.reset.done': 'Нулиране: заредени {n} потока',
    'confirm.reset': 'Това ще ИЗТРИЕ всички потоци, сесии и доклади. Сигурни ли сте?',
    'confirm.empty': 'Не е предоставен JSON — това ще изтрие всичко. Продължаване?',
    'toggle.disable': 'Деактивирай',
    'toggle.enable': 'Активирай',
    'refresh.auto': 'автообновяване на всеки 15s',
    'refresh.error': 'Грешка при връзка',
    'time.sec.ago': 'преди {n}s',
    'time.min.ago': 'преди {n}m',
    'time.hour.ago': 'преди {n}ч {m}m',
  },
};

let _lang = localStorage.getItem('lang') || 'bg';

function t(key) {
  return (TRANSLATIONS[_lang] || TRANSLATIONS.bg)[key] || TRANSLATIONS.en[key] || key;
}

function tf(key, vars) {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return s;
}

function setLang(lang) {
  _lang = lang;
  localStorage.setItem('lang', lang);
  applyTranslations();
  if (typeof onLangChange === 'function') onLangChange();
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = _lang === 'bg' ? 'EN' : 'BG';
}
