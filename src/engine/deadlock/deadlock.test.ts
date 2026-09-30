import { describe, expect, it } from 'vitest';
import { checkSafety, detectDeadlock, requestResources } from './run';
import { BANKER_BOOK, RAG_CYCLE_NO_DEADLOCK, RAG_DEADLOCK, diningPhilosophers } from './presets';
import type { BankerState, Rag } from './types';

/** True if every process can finish in the given order. Used to check the book's own sequences independently of our scan order. */
function isSafeSequence(s: BankerState, order: number[]) {
  let work = [...s.available];
  for (const i of order) {
    if (!s.max[i].every((m, r) => m - s.allocation[i][r] <= work[r])) return false;
    work = work.map((w, r) => w + s.allocation[i][r]);
  }
  return true;
}

describe('banker (Silberschatz, Operating System Concepts 10e, §8.6.3.3)', () => {
  it('initial state is safe', () => {
    const { steps, metrics } = checkSafety(BANKER_BOOK);
    expect(metrics.safe).toBe(true);
    // Book: "the sequence <P1, P3, P4, P2, P0> satisfies the safety criteria". Our scan finds a different, equally valid one.
    expect(isSafeSequence(BANKER_BOOK, [1, 3, 4, 2, 0])).toBe(true);
    expect(metrics.sequence).toEqual(['P1', 'P3', 'P4', 'P0', 'P2']);
    expect(steps[0].state).toMatchObject({ work: [3, 3, 2], picked: 'P1', need: [1, 2, 2], workAfter: [5, 3, 2] });
    expect(steps.at(-1)!.state.workAfter).toEqual([10, 5, 7]); // everything returned
  });

  // Book: P1 requests (1,0,2) -> granted, new state safe (Available becomes (2,3,0)).
  it('grants a safe request', () => {
    const r = requestResources(BANKER_BOOK, 1, [1, 0, 2]);
    expect(r).toMatchObject({ granted: true, reason: 'safe' });
    expect(r.state.available).toEqual([2, 3, 0]);
    expect(r.state.allocation[1]).toEqual([3, 0, 2]);
    // Book: "<P1, P3, P4, P0, P2> satisfies our safety requirement" in the new state.
    expect(isSafeSequence(r.state, [1, 3, 4, 0, 2])).toBe(true);
  });

  // Book, same section, in the state after P1's request: P4's (3,3,0) can't be granted (not available);
  // P0's (0,2,0) can't be granted even though available, because the result is unsafe.
  it('refuses unavailable and unsafe requests', () => {
    const after = requestResources(BANKER_BOOK, 1, [1, 0, 2]).state;
    expect(requestResources(after, 4, [3, 3, 0])).toMatchObject({ granted: false, reason: 'not-available', trace: null });
    const p0 = requestResources(after, 0, [0, 2, 0]);
    expect(p0).toMatchObject({ granted: false, reason: 'unsafe' });
    expect(p0.state).toBe(after);
    expect(p0.trace!.steps.at(-1)!.explain.summary).toMatch(/^Unsafe/);
  });

  it('rejects a request beyond the declared maximum', () => {
    expect(requestResources(BANKER_BOOK, 3, [1, 0, 0]).reason).toBe('exceeds-max'); // P3 needs (0,1,1)
  });
});

describe('deadlock detection', () => {
  // Silberschatz 10e §8.3.2: graph with a deadlock (cycles P1→R1→P2→R3→P3→R2→P1 and P2→R3→P3→R2→P2).
  it('finds the book deadlock and a cycle through it', () => {
    const r = detectDeadlock(RAG_DEADLOCK);
    expect(r.deadlocked).toEqual(['P1', 'P2', 'P3']);
    expect(r.cycle).toEqual(['P1', 'R1', 'P2', 'R3', 'P3', 'R2']);
    expect(r.explain.summary).toBe('Deadlock: P1, P2, P3 can never finish.');
  });

  // Same figure without P3's request edge: no deadlock.
  it('no deadlock once P3 stops waiting', () => {
    const r = detectDeadlock({ ...RAG_DEADLOCK, requests: RAG_DEADLOCK.requests.filter((e) => e.from !== 'P3') });
    expect(r.deadlocked).toEqual([]);
    expect(r.cycle).toBeNull();
    expect(r.finishOrder).toEqual(['P3', 'P2', 'P1']);
  });

  // Silberschatz 10e §8.3.2: cycle P1→R1→P3→R2→P1 but no deadlock, because R1 and R2 have two instances each.
  it('cycle without deadlock (multi-instance)', () => {
    const r = detectDeadlock(RAG_CYCLE_NO_DEADLOCK);
    expect(r.deadlocked).toEqual([]);
    expect(r.cycle).toEqual(['P1', 'R1', 'P3', 'R2']);
    expect(r.explain.summary).toBe('Cycle, but no deadlock.');
  });

  // Silberschatz 10e §8.7.2 detection example: A=7, B=2, C=6, Available (0,0,0). Not deadlocked;
  // then P2 requests one more C and P1, P2, P3, P4 deadlock (P0 can still finish).
  it('multi-instance detection example', () => {
    const R = ['A', 'B', 'C'];
    const alloc = [[0, 1, 0], [2, 0, 0], [3, 0, 3], [2, 1, 1], [0, 0, 2]];
    const request = [[0, 0, 0], [2, 0, 2], [0, 0, 0], [1, 0, 0], [0, 0, 2]];
    const rag = (req: number[][]): Rag => ({
      processes: alloc.map((_, i) => `P${i}`),
      resources: [{ id: 'A', instances: 7 }, { id: 'B', instances: 2 }, { id: 'C', instances: 6 }],
      holds: alloc.flatMap((row, i) => row.flatMap((c, r) => (c ? [{ from: R[r], to: `P${i}`, count: c }] : []))),
      requests: req.flatMap((row, i) => row.flatMap((c, r) => (c ? [{ from: `P${i}`, to: R[r], count: c }] : []))),
    });
    expect(detectDeadlock(rag(request)).deadlocked).toEqual([]);
    const worse = request.map((row, i) => (i === 2 ? [0, 0, 1] : row));
    expect(detectDeadlock(rag(worse))).toMatchObject({ deadlocked: ['P1', 'P2', 'P3', 'P4'], finishOrder: ['P0'] });
  });

  // Dijkstra's dining philosophers: circular wait deadlocks; ordering resources breaks it.
  it('dining philosophers: naive deadlocks, ordered does not', () => {
    const naive = detectDeadlock(diningPhilosophers(5));
    expect(naive.deadlocked).toHaveLength(5);
    expect(naive.cycle).toHaveLength(10);
    const fixed = detectDeadlock(diningPhilosophers(5, { ordered: true }));
    expect(fixed.deadlocked).toEqual([]);
    expect(fixed.finishOrder).toEqual(['Ph3', 'Ph2', 'Ph1', 'Ph0']);
  });

  it('rejects inconsistent graphs', () => {
    expect(() => detectDeadlock({ processes: ['P1'], resources: [{ id: 'R1', instances: 1 }], requests: [], holds: [{ from: 'R1', to: 'P1', count: 2 }] })).toThrow('R1 has 1 instance but 2 are assigned.');
  });

  it('is deterministic and serialisable', () => {
    expect(JSON.parse(JSON.stringify(checkSafety(BANKER_BOOK)))).toEqual(checkSafety(BANKER_BOOK));
    expect(detectDeadlock(diningPhilosophers(4))).toEqual(detectDeadlock(diningPhilosophers(4)));
  });
});
