import type { BankerState, Rag } from './types';

/** Silberschatz, Operating System Concepts 10e, §8.6.3.3: five processes, resources A=10, B=5, C=7. */
export const BANKER_BOOK: BankerState = {
  available: [3, 3, 2],
  max: [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]],
  allocation: [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
};

const edges = (xs: [string, string, number?][]) => xs.map(([from, to, count = 1]) => ({ from, to, count }));

/** Silberschatz 10e §8.3.2, resource-allocation graph with a deadlock: P1, P2, P3 wait on each other. */
export const RAG_DEADLOCK: Rag = {
  processes: ['P1', 'P2', 'P3'],
  resources: [{ id: 'R1', instances: 1 }, { id: 'R2', instances: 2 }, { id: 'R3', instances: 1 }, { id: 'R4', instances: 3 }],
  requests: edges([['P1', 'R1'], ['P2', 'R3'], ['P3', 'R2']]),
  holds: edges([['R1', 'P2'], ['R2', 'P1'], ['R2', 'P2'], ['R3', 'P3']]),
};

/** Silberschatz 10e §8.3.2, graph with a cycle but no deadlock: P4 and P2 can release the instances P1 and P3 wait for. */
export const RAG_CYCLE_NO_DEADLOCK: Rag = {
  processes: ['P1', 'P2', 'P3', 'P4'],
  resources: [{ id: 'R1', instances: 2 }, { id: 'R2', instances: 2 }],
  requests: edges([['P1', 'R1'], ['P3', 'R2']]),
  holds: edges([['R1', 'P2'], ['R1', 'P3'], ['R2', 'P1'], ['R2', 'P4']]),
};

/**
 * Dining philosophers (Dijkstra 1965) frozen at the moment everyone has picked up one fork.
 * Philosopher i uses forks F_i and F_(i+1 mod n).
 * - naive: each grabbed the left fork and waits for the right one, a cycle through every philosopher.
 * - ordered: each grabs the LOWER-numbered fork first. The last philosopher then reaches for F0 (taken) and holds nothing,
 *   so F_(n-1) stays free and the chain unwinds. Resource ordering breaks the circular-wait condition.
 */
export function diningPhilosophers(n: number, { ordered = false } = {}): Rag {
  if (!Number.isInteger(n) || n < 2 || n > 12) throw new Error('Between 2 and 12 philosophers.');
  const ph = (i: number) => `Ph${i}`, f = (i: number) => `F${i % n}`;
  const rag: Rag = { processes: [], resources: [], requests: [], holds: [] };
  for (let i = 0; i < n; i++) {
    rag.processes.push(ph(i));
    rag.resources.push({ id: f(i), instances: 1 });
    const [first, second] = ordered && i === n - 1 ? [f(0), f(i)] : [f(i), f(i + 1)];
    if (ordered && i === n - 1) rag.requests.push({ from: ph(i), to: first, count: 1 });
    else {
      rag.holds.push({ from: first, to: ph(i), count: 1 });
      rag.requests.push({ from: ph(i), to: second, count: 1 });
    }
  }
  return rag;
}
