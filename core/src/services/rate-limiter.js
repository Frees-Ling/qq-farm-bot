/**
 * 请求队列与并发控制模块
 * 解决批量操作无并发限制的问题，防止触发服务端限流
 */

const { createModuleLogger } = require('./logger')

const logger = createModuleLogger('rate-limiter')

// 默认配置
const DEFAULT_CONFIG = {
  maxConcurrent: 3, // 最大并发数
  minInterval: 100, // 最小请求间隔(ms)
  maxRetries: 2, // 最大重试次数
  retryDelay: 500, // 重试延迟(ms)
  enableBurst: false, // 是否允许突发
  burstSize: 5, // 突发大小
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 简单的令牌桶实现
class TokenBucket {
  constructor(options = {}) {
    this.capacity = options.capacity || DEFAULT_CONFIG.maxConcurrent
    this.tokens = this.capacity
    this.refillRate = options.refillRate || 1000 // 每秒填充令牌数
    this.lastRefill = Date.now()
    this.maxWait = options.maxWait || 5000 // 最大等待时间
  }

  refill() {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const tokensToAdd = (elapsed / this.refillRate) * this.capacity
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd)
    this.lastRefill = now
  }

  async acquire(tokens = 1) {
    const startWait = Date.now()

    while (this.tokens < tokens) {
      if (Date.now() - startWait > this.maxWait)
        throw new Error('请求等待超时')
      this.refill()
      await sleep(50)
    }

    this.tokens -= tokens
    return true
  }

  release(tokens = 1) {
    this.tokens = Math.min(this.capacity, this.tokens + tokens)
  }
}

// 优先级队列
class PriorityQueue {
  constructor() {
    this.queue = []
  }

  enqueue(item, priority = 0) {
    this.queue.push({ item, priority, ts: Date.now() })
    // 高优先级先出，同优先级按入队时间先出
    this.queue.sort((a, b) => (b.priority - a.priority) || (a.ts - b.ts))
  }

  dequeue() {
    const v = this.queue.shift()
    return v ? v.item : null
  }

  get size() {
    return this.queue.length
  }
}

class RateLimiter {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.queue = new PriorityQueue()
    this.inFlight = 0
    this.lastRunAt = 0
    this.bucket = new TokenBucket({
      capacity: this.config.maxConcurrent,
      maxWait: 5000,
    })
    this._draining = false
  }

  add(taskFn, options = {}) {
    const priority = options.priority ?? 0
    const maxRetries = options.maxRetries ?? this.config.maxRetries
    return new Promise((resolve, reject) => {
      this.queue.enqueue({ taskFn, resolve, reject, maxRetries }, priority)
      this._drain().catch(err => logger.error('drain failed', err))
    })
  }

  async _runWithRetry(entry) {
    let attempt = 0
    while (true) {
      try {
        return await entry.taskFn()
      }
      catch (err) {
        attempt += 1
        if (attempt > entry.maxRetries)
          throw err
        await sleep(this.config.retryDelay)
      }
    }
  }

  async _drain() {
    if (this._draining)
      return
    this._draining = true

    try {
      while (this.queue.size > 0) {
        if (this.inFlight >= this.config.maxConcurrent)
          break

        const now = Date.now()
        const waitMs = Math.max(0, this.config.minInterval - (now - this.lastRunAt))
        if (waitMs > 0)
          await sleep(waitMs)

        await this.bucket.acquire(1)

        const entry = this.queue.dequeue()
        if (!entry) {
          this.bucket.release(1)
          break
        }

        this.inFlight += 1
        this.lastRunAt = Date.now()

        Promise.resolve()
          .then(() => this._runWithRetry(entry))
          .then(res => entry.resolve(res))
          .catch(err => entry.reject(err))
          .finally(() => {
            this.inFlight -= 1
            this.bucket.release(1)
            this._drain().catch(() => {})
          })
      }
    }
    finally {
      this._draining = false
    }
  }
}

module.exports = {
  DEFAULT_CONFIG,
  TokenBucket,
  PriorityQueue,
  RateLimiter,
  sleep,
}