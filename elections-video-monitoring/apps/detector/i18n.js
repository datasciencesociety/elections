const TRANSLATIONS = {
  en: {
    // Metric labels
    'metric.luma':       'Luminance',
    'metric.diff':       'Motion Diff',
    'metric.cover':      'Cover Ratio',
    'metric.frozen':     'Frozen For',
    'metric.rectime':    'Rec. Time',
    'metric.lastcheck':  'Last Check',
    // Config panel
    'config.title':      'Configuration',
    'config.interval':   'Check Interval (s)',
    'config.freeze':     'Freeze Alert Threshold (s)',
    'config.motion':     'Motion Sensitivity (diff threshold)',
    'config.coverarea':  'Cover Area Threshold (%)',
    'config.coverdur':   'Cover Duration Threshold (s)',
    'config.covervar':   'Cover Variance Sensitivity',
    'config.lowcpu':     'Low CPU mode (160×90)',
    'config.notif':      'Browser notifications',
    'config.reset':      'Reset to Defaults',
    // Alert log
    'log.title':         'Alert Log',
    'btn.copy':          'Copy',
    'btn.clear':         'Clear',
    'btn.testnotif':     'Test',
    // URL input
    'url.placeholder':   'Enter HLS (.m3u8) or video stream URL…',
    // Footer
    'footer':            'Runs 100% in browser',
    // Status messages
    'idle':              'Idle — enter a URL to begin',
    'connecting':        'Connecting…',
    'stream.ok':         'Stream OK',
    'stream.ok.active':  'Monitoring active',
    'stream.ok.checked': 'Last checked: {t}',
    'covered.status':    '🚨 CAMERA COVERED',
    'covered.detail':    '{pct}% of frame covered for {s}s',
    'covered.warn':      'Possible Camera Cover',
    'covered.warn.detail': '{pct}% covered for {s}s (threshold: {dur}s)',
    'dark.status':       '🚨 NO SIGNAL',
    'dark.detail':       'Average luminance: {luma} (threshold: 20)',
    'frozen.status':     '🚨 FROZEN / NO MOVEMENT',
    'frozen.detail':     'No movement for {s}s',
    'freeze.warn':       'Approaching Freeze Threshold',
    'freeze.warn.detail': 'No movement for {s}s (threshold: {dur}s)',
    'retry.status':      'Connection error — retrying ({n}/{max})',
    'unavailable':       'Stream Unavailable',
    'ended':             '🚨 STREAM ENDED',
    'ended.beyond':      'Requested t={t}s is past stream end (duration: {dur}s)',
    'ended.normal':      'Stream ended at {dur}s',
    'ended.unknown':     'Stream ended at ?',
    // Log messages
    'log.ready':         'Stream Freeze Detector ready',
    'log.started':       'Starting stream: {url}',
    'log.loaded':        'Stream loaded — monitoring started',
    'log.stopped':       'Monitoring stopped by user',
    'log.stalled':       'Stream stalled',
    'log.retry':         'Retrying in {delay}s… (attempt {n}/{max})',
    'log.maxretry':      'Max retries reached — stopped',
    'log.no.url':        'Please enter a stream URL',
    'log.notif.denied':  'Notification permission denied',
    'log.cors':          'CORS/SecurityError: canvas read blocked — {msg}',
    'log.autoplay':      'Autoplay blocked: {msg} — click the video to start',
    'log.video.error':   'Video error: {msg}',
    'log.hls.error':     'HLS fatal error: {type} / {details}',
    // Notifications
    'notif.test':        'Test Notification',
    'notif.test.body':   'Notifications are working!',
    'notif.covered':     '🚨 Camera Covered',
    'notif.dark':        '🚨 No Signal',
    'notif.dark.body':   'Stream luminance dropped to {luma}',
    'notif.frozen':      '🚨 Stream Frozen',
    'notif.frozen.body': 'No movement detected for {s}s',
    'notif.unavailable': '❌ Stream Unavailable',
    'notif.ended':       '🚨 Stream Ended',
  },
  bg: {
    'metric.luma':       'Яркост',
    'metric.diff':       'Разлика в движение',
    'metric.cover':      'Покриване',
    'metric.frozen':     'Замразено за',
    'metric.rectime':    'Вр. на запис',
    'metric.lastcheck':  'Последна проверка',
    'config.title':      'Конфигурация',
    'config.interval':   'Интервал за проверка (сек)',
    'config.freeze':     'Праг за замразяване (сек)',
    'config.motion':     'Чувствителност на движение',
    'config.coverarea':  'Праг за покриване (%)',
    'config.coverdur':   'Праг за продължителност (сек)',
    'config.covervar':   'Чувствителност на дисперсия',
    'config.lowcpu':     'Нисък CPU режим (160×90)',
    'config.notif':      'Известия от браузъра',
    'config.reset':      'Нулиране по подразбиране',
    'log.title':         'Журнал на известия',
    'btn.copy':          'Копиране',
    'btn.clear':         'Изчистване',
    'btn.testnotif':     'Тест',
    'url.placeholder':   'Въведете HLS (.m3u8) или URL на видео поток…',
    'footer':            'Работи 100% в браузъра',
    'idle':              'Неактивен — въведете URL за начало',
    'connecting':        'Свързване…',
    'stream.ok':         'Потокът е наред',
    'stream.ok.active':  'Наблюдението е активно',
    'stream.ok.checked': 'Последна проверка: {t}',
    'covered.status':    '🚨 КАМЕРАТА Е ПОКРИТА',
    'covered.detail':    '{pct}% от кадъра покрит за {s}с',
    'covered.warn':      'Възможно покриване на камерата',
    'covered.warn.detail': '{pct}% покрит за {s}с (праг: {dur}с)',
    'dark.status':       '🚨 НЯМА СИГНАЛ',
    'dark.detail':       'Средна яркост: {luma} (праг: 20)',
    'frozen.status':     '🚨 ЗАМРАЗЕН / НЯМА ДВИЖЕНИЕ',
    'frozen.detail':     'Няма движение за {s}с',
    'freeze.warn':       'Приближаване към прага на замразяване',
    'freeze.warn.detail': 'Няма движение за {s}с (праг: {dur}с)',
    'retry.status':      'Грешка при връзка — повторен опит ({n}/{max})',
    'unavailable':       'Потокът е недостъпен',
    'ended':             '🚨 ПОТОКЪТ ЗАВЪРШИ',
    'ended.beyond':      'Заявено t={t}с е след края на потока (продължителност: {dur}с)',
    'ended.normal':      'Потокът завърши на {dur}с',
    'ended.unknown':     'Потокът завърши на ?',
    'log.ready':         'Детекторът за замразяване е готов',
    'log.started':       'Стартиране на поток: {url}',
    'log.loaded':        'Потокът е зареден — наблюдението е активно',
    'log.stopped':       'Наблюдението е спряно от потребителя',
    'log.stalled':       'Потокът е прекъснат',
    'log.retry':         'Повторен опит след {delay}с… ({n}/{max})',
    'log.maxretry':      'Достигнат максимален брой опити — спряно',
    'log.no.url':        'Моля въведете URL на поток',
    'log.notif.denied':  'Разрешението за известия е отказано',
    'log.cors':          'CORS/SecurityError: четенето на canvas е блокирано — {msg}',
    'log.autoplay':      'Автоплейът е блокиран: {msg} — кликнете върху видеото за старт',
    'log.video.error':   'Видео грешка: {msg}',
    'log.hls.error':     'Фатална HLS грешка: {type} / {details}',
    'notif.test':        'Тестово известие',
    'notif.test.body':   'Известията работят!',
    'notif.covered':     '🚨 Камерата е покрита',
    'notif.dark':        '🚨 Няма сигнал',
    'notif.dark.body':   'Яркостта на потока спадна до {luma}',
    'notif.frozen':      '🚨 Потокът е замразен',
    'notif.frozen.body': 'Не е открито движение за {s}с',
    'notif.unavailable': '❌ Потокът е недостъпен',
    'notif.ended':       '🚨 Потокът завърши',
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

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}
