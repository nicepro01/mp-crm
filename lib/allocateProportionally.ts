// Делит общее число между несколькими "получателями" пропорционально их
// весам (напр. нехватке каждой площадки), методом наибольшего остатка —
// чтобы сумма долей точно совпадала с total, без потерь на округлении.
// Если все веса нулевые — делит поровну.
export function allocateProportionally(total: number, weights: number[]): number[] {
  if (total <= 0 || weights.length === 0) return weights.map(() => 0);
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  const effectiveWeights = sumWeights > 0 ? weights : weights.map(() => 1);
  const effectiveSum = sumWeights > 0 ? sumWeights : weights.length;

  const raw = effectiveWeights.map((w) => (w / effectiveSum) * total);
  const floors = raw.map(Math.floor);
  const remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let k = 0; k < remainder; k++) {
    result[order[k % order.length].i] += 1;
  }
  return result;
}
