import { Injectable } from '@nestjs/common'

export type MetricLabels = Record<string, string | number | boolean>

type MetricRecord = {
  name: string
  labels: MetricLabels
  value: number
}

type RateRecord = {
  name: string
  labels: MetricLabels
  buckets: Map<number, number>
}

@Injectable()
export class MetricsService {
  private readonly windowSeconds: number
  private readonly counters = new Map<string, MetricRecord>()
  private readonly gauges = new Map<string, MetricRecord>()
  private readonly rates = new Map<string, RateRecord>()

  constructor() {
    const parsed = parseInt(process.env.METRICS_RATE_WINDOW_SECONDS || '60', 10)
    this.windowSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 60
  }

  increment(name: string, labels: MetricLabels = {}, value = 1): void {
    const key = this.buildKey(name, labels)
    const record = this.counters.get(key)
    if (record) {
      record.value += value
      return
    }
    this.counters.set(key, { name, labels: this.normalizeLabels(labels), value })
  }

  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.buildKey(name, labels)
    this.gauges.set(key, { name, labels: this.normalizeLabels(labels), value })
  }

  observeRate(name: string, labels: MetricLabels = {}, value = 1): void {
    if (this.windowSeconds <= 0) {
      return
    }
    const key = this.buildKey(name, labels)
    let record = this.rates.get(key)
    if (!record) {
      record = { name, labels: this.normalizeLabels(labels), buckets: new Map() }
      this.rates.set(key, record)
    }
    const now = Math.floor(Date.now() / 1000)
    record.buckets.set(now, (record.buckets.get(now) || 0) + value)
    this.pruneBuckets(record.buckets, now)
  }

  snapshot() {
    const now = Math.floor(Date.now() / 1000)
    const counters = Array.from(this.counters.values())
    const gauges = Array.from(this.gauges.values())
    const rates = Array.from(this.rates.values()).map((record) => {
      this.pruneBuckets(record.buckets, now)
      const count = Array.from(record.buckets.values()).reduce((sum, val) => sum + val, 0)
      return {
        name: record.name,
        labels: record.labels,
        value: count / this.windowSeconds,
        count,
        windowSeconds: this.windowSeconds,
      }
    })

    return {
      timestamp: new Date().toISOString(),
      counters,
      gauges,
      rates,
    }
  }

  private buildKey(name: string, labels: MetricLabels): string {
    const normalized = this.normalizeLabels(labels)
    const labelKey = Object.entries(normalized)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',')
    return labelKey ? `${name}|${labelKey}` : name
  }

  private normalizeLabels(labels: MetricLabels): MetricLabels {
    const normalized: MetricLabels = {}
    Object.keys(labels).forEach((key) => {
      normalized[key] = String(labels[key])
    })
    return normalized
  }

  private pruneBuckets(buckets: Map<number, number>, nowSeconds: number): void {
    const threshold = nowSeconds - this.windowSeconds + 1
    for (const key of buckets.keys()) {
      if (key < threshold) {
        buckets.delete(key)
      }
    }
  }
}
