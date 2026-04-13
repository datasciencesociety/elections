import * as Sentry from "@sentry/node";

const isProd = process.env.NODE_ENV === "production";

Sentry.init({
  dsn: isProd
    ? "https://358b06abc279b541c8045224359692f4@o4511213540540416.ingest.de.sentry.io/4511213543293008"
    : undefined,
  enabled: isProd,
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
});
