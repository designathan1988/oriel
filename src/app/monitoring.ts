// Error monitoring of the production build (Sentry): what customers hit on their own GPUs, browsers and
// projects, which no check on this machine can reach. Loaded only when the build has a DSN
// (VITE_SENTRY_DSN in .env.production); without one the app sends nothing anywhere.
//   - uncaught exceptions and rejected promises (the SDK's own handlers);
//   - the problems the app reports about itself (f3/kernel/problems.ts): a lost WebGL context, a
//     worker failure, a mesh the kernel refused;
//   - a replay of the minute before an error only (no sessions without an error), with every text
//     masked and every image and canvas blocked: project content never leaves the browser.
import * as Sentry from '@sentry/browser';
import { onProblem } from '../f3/kernel/problems';

export function startMonitoring(dsn: string): void {
  Sentry.init({
    dsn,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    integrations: [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
  onProblem((p) => {
    // Exceptions and promises are already captured by the SDK itself.
    if (p.source === 'exception' || p.source === 'promise') return;
    Sentry.captureMessage(`[${p.source}] ${p.message}`, p.severity === 'error' ? 'error' : 'warning');
  });
}
