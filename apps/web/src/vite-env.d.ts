/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server origin when the web app is deployed separately, e.g. https://chicken-slave.onrender.com */
  readonly VITE_SOCKET_URL?: string;
}
