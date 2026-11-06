export function nextMediaIndex(current: number, count: number, step: -1 | 1): number {
  if (count <= 0) return 0;
  return (current + step + count) % count;
}
