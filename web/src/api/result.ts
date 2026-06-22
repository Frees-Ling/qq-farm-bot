export interface ApiOk<T = unknown> {
  ok: true
  data: T
}

export interface ApiFail {
  ok: false
  error?: string
  message?: string
}

export type ApiResult<T = unknown> = ApiOk<T> | ApiFail

export class ApiResponseError extends Error {
  readonly payload?: unknown

  constructor(message: string, payload?: unknown) {
    super(message)
    this.name = 'ApiResponseError'
    this.payload = payload
  }
}

export function isApiOk<T>(v: any): v is ApiOk<T> {
  return !!v && v.ok === true
}

export function getApiErrorMessage(v: any, fallback = '请求失败') {
  return String(v?.error || v?.message || fallback)
}

/**
 * Unwrap `{ ok: true, data }` response or throw `ApiResponseError`.
 * Useful to reduce repetitive `if (res.data.ok)` branches.
 */
export function unwrapOk<T>(resData: ApiResult<T>, fallbackError = '请求失败'): T {
  if (isApiOk<T>(resData))
    return resData.data
  throw new ApiResponseError(getApiErrorMessage(resData, fallbackError), resData)
}
