import 'axios'

declare module 'axios' {
  export interface AxiosRequestConfig {
    /**
     * When true, suppress global toast / redirect handling.
     * Use for pages that handle errors locally (e.g. login forms).
     */
    silent?: boolean
  }
}
