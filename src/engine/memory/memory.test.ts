import { describe, expect, it } from 'vitest';
import { BELADY_PRESET, PAGE_ALGOS, SILBERSCHATZ_REFS, faultCurve, findBelady, generateRefs, runPaging } from './run';

const faults = (algo: 'fifo' | 'lru' | 'opt' | 'clock', frames: number, refs = SILBERSCHATZ_REFS) => runPaging({ refs, frames, algo }).metrics.faults;

describe('textbook examples', () => {
  // Silberschatz, Operating System Concepts 10e, §10.4.2–10.4.4, reference string 7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1
  // with 3 frames: FIFO 15 faults (Fig. 10.12), Optimal 9 (Fig. 10.14), LRU 12 (Fig. 10.15).
  it('FIFO 15, Optimal 9, LRU 12', () => {
    expect(faults('fifo', 3)).toBe(15);
    expect(faults('opt', 3)).toBe(9);
    expect(faults('lru', 3)).toBe(12);
  });

  // Silberschatz 10e Fig. 10.12: after 7,0,1 the frames hold 7,0,1; page 2 then replaces 7 in the same slot.
  it('FIFO frame contents keep stable slots', () => {
    const { steps } = runPaging({ refs: SILBERSCHATZ_REFS, frames: 3, algo: 'fifo' });
    expect(steps[2].state.frames).toEqual([7, 0, 1]);
    expect(steps[3].state).toMatchObject({ frames: [2, 0, 1], victim: 7, fault: true });
    expect(steps[4].state).toMatchObject({ hit: true, victim: null });
    expect(steps[3].explain.why).toBe('FIFO evicts the page loaded earliest: page 7 arrived at ref #1.');
  });

  // Belady's anomaly, Silberschatz 10e §10.4.2 (Fig. 10.13): 1,2,3,4,1,2,5,1,2,3,4,5 gives 9 faults with 3 frames, 10 with 4.
  it("Belady's anomaly", () => {
    expect(faults('fifo', 3, BELADY_PRESET.refs)).toBe(9);
    expect(faults('fifo', 4, BELADY_PRESET.refs)).toBe(10);
    expect(findBelady(BELADY_PRESET.refs, 5)).toEqual({ from: 3, to: 4 });
  });

  // Clock (second chance), Silberschatz 10e §10.4.5.2. The book gives no fault count for this string, so this is a
  // hand trace (load sets the reference bit; the hand starts at frame 0 and stops just past each replaced frame): 14 faults.
  it('Clock, hand-traced', () => {
    const { steps, metrics } = runPaging({ refs: SILBERSCHATZ_REFS, frames: 3, algo: 'clock' });
    expect(metrics.faults).toBe(14);
    expect(steps[3].state).toMatchObject({ frames: [2, 0, 1], refBit: [1, 0, 0], hand: 1 }); // full sweep cleared every bit, 7 evicted
    expect(steps[5].state).toMatchObject({ frames: [2, 0, 3], victim: 1 }); // 0 was just re-referenced, so 1 goes instead
    expect(steps.at(-1)!.state.frames).toEqual([0, 7, 1]);
  });
});

describe('properties', () => {
  const random = Array.from({ length: 20 }, (_, seed) => generateRefs({ seed, length: 40, pages: 8, locality: 0.5 }));

  it('Optimal never faults more than any other algorithm', () => {
    for (const refs of random) for (const f of [2, 3, 4]) for (const a of PAGE_ALGOS) expect(faults('opt', f, refs)).toBeLessThanOrEqual(faults(a, f, refs));
  });

  it('stack algorithms (LRU, Optimal) never show Belady’s anomaly', () => {
    for (const refs of random) for (const a of ['lru', 'opt'] as const) {
      const c = faultCurve(refs, a, 8);
      c.forEach((x, i) => i && expect(x).toBeLessThanOrEqual(c[i - 1]));
    }
  });

  it('page table mirrors the frames', () => {
    const s = runPaging({ refs: [3, 5, 3, 9], frames: 2, algo: 'lru' }).steps.at(-1)!.state;
    expect(s.frames).toEqual([3, 9]);
    expect(s.pageTable).toEqual({ 3: 0, 9: 1 });
  });

  it('generator is seeded', () => {
    const p = { seed: 7, length: 30, pages: 6, locality: 0.3 };
    expect(generateRefs(p)).toEqual(generateRefs(p));
    expect(generateRefs(p).every((x) => x >= 0 && x < 6)).toBe(true);
  });

  it('is deterministic and serialisable', () => {
    const a = runPaging({ refs: SILBERSCHATZ_REFS, frames: 3, algo: 'clock', tlbEntries: 2 });
    expect(runPaging({ refs: SILBERSCHATZ_REFS, frames: 3, algo: 'clock', tlbEntries: 2 })).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe('TLB', () => {
  it('caches translations LRU and counts hits', () => {
    const r = runPaging({ refs: [1, 1, 2, 1], frames: 3, algo: 'fifo', tlbEntries: 1 });
    expect(r.steps.map((s) => s.state.tlbHit)).toEqual([false, true, false, false]);
    expect(r.metrics.tlbHitRate).toBe(0.25);
  });

  it('drops the translation of an evicted page', () => {
    const r = runPaging({ refs: [1, 2, 1], frames: 1, algo: 'fifo', tlbEntries: 2 });
    expect(r.steps[1].state.tlb).toEqual([{ page: 2, frame: 0 }]);
    expect(r.steps[2].state.tlbHit).toBe(false);
  });
});

it('rejects bad input', () => {
  expect(() => runPaging({ refs: [], frames: 0, algo: 'fifo' })).toThrow('Enter at least one page reference.\nFrames must be between 1 and 64.');
});
