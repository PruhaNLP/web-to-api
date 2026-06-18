// ======Settings=========
export const AUTO_MODEL_ID = 'auto';
const DEFAULT_AUTO_MODEL_ORDER = [
  'deepseek-web/deepseek-v4-pro-reasoner',
  'qwen-web/qwen3.7-plus',
  'deepseek-web/deepseek-v4-flash-reasoner',
  'deepseek-web/deepseek-v4-pro',
  'deepseek-web/deepseek-v4-flash',
  'kimi-web/kimi-k2.5',
  'qwen-web/qwen3.7-max',
  'qwen-web/qwen3.6-plus',
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
