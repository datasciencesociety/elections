import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.PROD
    ? "https://0d0da7df7088753e036f602878ad8792@o4511213540540416.ingest.de.sentry.io/4511213567410256"
    : undefined,
  enabled: import.meta.env.PROD,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
