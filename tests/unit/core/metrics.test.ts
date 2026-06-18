import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../../src/core/metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  it('records and retrieves metrics', () => {
    metrics.record({
      timestamp: Date.now(),
      provider: 'claude-web',
      model: 'claude-sonnet-4-6',
      latencyMs: 1500,
      status: 'success',
      format: 'openai',
    });
    expect(metrics.getRecent(10)).toHaveLength(1);
  });

  it('summary calculates correctly', () => {
    metrics.record({ timestamp: 1, provider: 'claude-web', model: 'm', latencyMs: 100, status: 'success', format: 'openai' });
    metrics.record({ timestamp: 2, provider: 'claude-web', model: 'm', latencyMs: 200, status: 'success', format: 'openai' });
    metrics.record({ timestamp: 3, provider: 'claude-web', model: 'm', latencyMs: 300, status: 'error', errorCode: 'timeout', format: 'openai' });

    const summary = metrics.getSummary();
    expect(summary.totalRequests).toBe(3);
    expect(summary.successRate).toBeCloseTo(2/3);
    expect(summary.avgLatencyMs).toBe(200);
    expect(summary.byProvider['claude-web'].count).toBe(3);
  });

  it('limits history to maxHistory', () => {
    for (let i = 0; i < 1100; i++) {
      metrics.record({ timestamp: i, provider: 'p', model: 'm', latencyMs: 10, status: 'success', format: 'openai' });
    }
    expect(metrics.getRecent(2000).length).toBeLessThanOrEqual(1000);
  });

  it('empty summary returns zeros', () => {
    const summary = metrics.getSummary();
    expect(summary.totalRequests).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.avgLatencyMs).toBe(0);
  });

  it('tracks by provider separately', () => {
    metrics.record({ timestamp: 1, provider: 'claude-web', model: 'm', latencyMs: 100, status: 'success', format: 'openai' });
    metrics.record({ timestamp: 2, provider: 'deepseek-web', model: 'm', latencyMs: 50, status: 'success', format: 'anthropic' });

    const summary = metrics.getSummary();
    expect(Object.keys(summary.byProvider)).toHaveLength(2);
    expect(summary.byProvider['claude-web'].avgLatencyMs).toBe(100);
    expect(summary.byProvider['deepseek-web'].avgLatencyMs).toBe(50);
  });

  it('clear resets all metrics', () => {
    metrics.record({ timestamp: 1, provider: 'p', model: 'm', latencyMs: 10, status: 'success', format: 'openai' });
    metrics.clear();
    expect(metrics.getRecent(10)).toHaveLength(0);
  });
});
