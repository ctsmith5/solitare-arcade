/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the Go API, e.g. https://solitare-backend-production.up.railway.app
   * Leave unset in development to use the dev-server proxy instead.
   */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
