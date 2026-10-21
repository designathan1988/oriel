/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN of the production build (.env.production at the repository root); none = no monitoring. */
  readonly VITE_SENTRY_DSN?: string;
  /** Release name reported with the errors (e.g. oriel@3.0.0). */
  readonly VITE_SENTRY_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
