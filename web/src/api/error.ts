import type { AxiosError } from 'axios'
import { ApiResponseError } from '@/api/result'

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null
}

function isAxiosError(v: unknown): v is AxiosError {
  return isObject(v) && (v as any).isAxiosError === true
}

/**
 * Extract best-effort error message for UI display.
 * - Supports AxiosError response payloads (`error` / `message`)
 * - Supports ApiResponseError thrown by `unwrapOk`
 */
export function getErrorMessage(err: unknown, fallback = '操作失败') {
  if (err instanceof ApiResponseError)
    return err.message || fallback

  if (isAxiosError(err)) {
    const data = (err.response as any)?.data
    const msg = data?.error || data?.message || err.message
    return String(msg || fallback)
  }

  if (isObject(err) && typeof (err as any).message === 'string')
    return (err as any).message || fallback

  return fallback
}
