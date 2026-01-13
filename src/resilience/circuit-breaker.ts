export type CircuitState = 'closed' | 'open' | 'half-open'

export type CircuitBreakerOptions = {
  failureThreshold: number
  openDurationMs: number
  halfOpenSuccesses: number
}

export class CircuitOpenError extends Error {
  constructor(message: string = 'Circuit breaker is open') {
    super(message)
    this.name = 'CircuitOpenError'
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failureCount = 0
  private successCount = 0
  private openedAt = 0

  constructor(private readonly options: CircuitBreakerOptions) {}

  getState(): CircuitState {
    this.updateState()
    return this.state
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.updateState()
    if (this.state === 'open') {
      throw new CircuitOpenError()
    }
    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private updateState(): void {
    if (this.state !== 'open') {
      return
    }
    const elapsed = Date.now() - this.openedAt
    if (elapsed >= this.options.openDurationMs) {
      this.state = 'half-open'
      this.successCount = 0
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount += 1
      if (this.successCount >= this.options.halfOpenSuccesses) {
        this.reset()
      }
      return
    }
    this.failureCount = 0
  }

  private onFailure(): void {
    if (this.state === 'half-open') {
      this.trip()
      return
    }
    this.failureCount += 1
    if (this.failureCount >= this.options.failureThreshold) {
      this.trip()
    }
  }

  private trip(): void {
    this.state = 'open'
    this.openedAt = Date.now()
    this.failureCount = 0
    this.successCount = 0
  }

  private reset(): void {
    this.state = 'closed'
    this.failureCount = 0
    this.successCount = 0
  }
}
