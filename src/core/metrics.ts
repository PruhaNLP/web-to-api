export interface RequestMetric {
  timestamp: number;
  provider: string;
  model: string;
  latencyMs: number;
  status: 'success' | 'error';
  errorCode?: string;
  format: 'openai' | 'anthropic';
}

export class MetricsCollector {
  private metrics: RequestMetric[] = [];
  private maxHistory = 1000; // Keep last 1000 requests in memory

  record(metric: RequestMetric): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxHistory) {
      this.metrics = this.metrics.slice(-this.maxHistory);
    }
  }

  getRecent(count: number = 50): RequestMetric[] {
    return this.metrics.slice(-count);
  }

  getSummary(): {
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    byProvider: Record<string, { count: number; successRate: number; avgLatencyMs: number }>;
  } {
    const total = this.metrics.length;
    if (total === 0) {
      return { totalRequests: 0, successRate: 0, avgLatencyMs: 0, byProvider: {} };
    }

    const successes = this.metrics.filter(m => m.status === 'success').length;
    const avgLatency = this.metrics.reduce((sum, m) => sum + m.latencyMs, 0) / total;

    const byProvider: Record<string, { count: number; successes: number; totalLatency: number }> = {};
    for (const m of this.metrics) {
      if (!byProvider[m.provider]) {
        byProvider[m.provider] = { count: 0, successes: 0, totalLatency: 0 };
      }
      byProvider[m.provider].count++;
      if (m.status === 'success') byProvider[m.provider].successes++;
      byProvider[m.provider].totalLatency += m.latencyMs;
    }

    const byProviderResult: Record<string, { count: number; successRate: number; avgLatencyMs: number }> = {};
    for (const [id, data] of Object.entries(byProvider)) {
      byProviderResult[id] = {
        count: data.count,
        successRate: data.count > 0 ? data.successes / data.count : 0,
        avgLatencyMs: data.count > 0 ? Math.round(data.totalLatency / data.count) : 0,
      };
    }

    return {
      totalRequests: total,
      successRate: successes / total,
      avgLatencyMs: Math.round(avgLatency),
      byProvider: byProviderResult,
    };
  }

  clear(): void {
    this.metrics = [];
  }
}
