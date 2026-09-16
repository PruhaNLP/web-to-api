// ======Settings=========
export const AUTO_MODEL_ID = 'auto';
const DEFAULT_AUTO_MODEL_ORDER = [
  'deepseek-web/deepseek-expert-thinking',
  'qwen-web/qwen3.8-max',
  'deepseek-web/deepseek-instant-thinking',
  'deepseek-web/deepseek-expert',
  'deepseek-web/deepseek-instant',
  'kimi-web/kimi-k2.6',
  'qwen-web/qwen3.7-plus',
  'qwen-web/qwen3.7-max',
];
// ======Settings=========

let autoModelOrder = [...DEFAULT_AUTO_MODEL_ORDER];

export function getAutoModelOrder(): string[] {
  return [...autoModelOrder];
}

export function setAutoModelOrder(order: string[]): void {
  const next = order
    .map(item => item.trim())
    .filter(Boolean);
  if (next.length === 0) {
    throw new Error('auto model order cannot be empty');
  }
  autoModelOrder = [...new Set(next)];
}

export function resetAutoModelOrder(): string[] {
  autoModelOrder = [...DEFAULT_AUTO_MODEL_ORDER];
  return getAutoModelOrder();
}
