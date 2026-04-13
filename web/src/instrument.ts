import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "https://358b06abc279b541c8045224359692f4@o4511213540540416.ingest.de.sentry.io/4511213543293008",
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
