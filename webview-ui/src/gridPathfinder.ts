export interface GridPoint { col: number; row: number }

export type PathResult = { kind: 'path'; points: GridPoint[] } | { kind: 'unreachable' };

export function findGridPath(
  columns: number, rows: number, start: GridPoint, end: GridPoint,
  blocked: (col: number, row: number) => boolean,
): PathResult {
  const inside = (point: GridPoint) => point.col >= 0 && point.col < columns && point.row >= 0 && point.row < rows;
  if (!inside(start) || !inside(end) || blocked(end.col, end.row)) return { kind: 'unreachable' };
  if (start.col === end.col && start.row === end.row) return { kind: 'path', points: [] };

  const width = columns;
  const size = width * rows;
  const startIndex = start.row * width + start.col;
  const endIndex = end.row * width + end.col;
  const parents = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIndex;
  parents[startIndex] = startIndex;

  while (head < tail && parents[endIndex] === -1) {
    const index = queue[head++];
    const col = index % width;
    const row = Math.floor(index / width);
    for (const [nextCol, nextRow] of [[col, row - 1], [col, row + 1], [col - 1, row], [col + 1, row]]) {
      if (nextCol < 0 || nextCol >= width || nextRow < 0 || nextRow >= rows) continue;
      const nextIndex = nextRow * width + nextCol;
      if (parents[nextIndex] !== -1 || blocked(nextCol, nextRow)) continue;
      parents[nextIndex] = index;
      queue[tail++] = nextIndex;
    }
  }

  if (parents[endIndex] === -1) return { kind: 'unreachable' };
  const points: GridPoint[] = [];
  for (let index = endIndex; index !== startIndex; index = parents[index]) {
    points.push({ col: index % width, row: Math.floor(index / width) });
  }
  points.reverse();
  return { kind: 'path', points };
}