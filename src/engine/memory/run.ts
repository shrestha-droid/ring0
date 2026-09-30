import type { Rng, Step } from '../core/types';
import { mulberry32, randInt } from '../core/rng';
import type { PageAlgo, PagingParams, PagingState, PagingTrace, RefGenParams } from './types';

export const PAGE_ALGOS: PageAlgo[] = ['fifo', 'lru', 'opt', 'clock'];
export const pageAlgoLabel: Record<PageAlgo, string> = { fifo: 'FIFO', lru: 'LRU', opt: 'Optimal', clock: 'Clock' };

/** 1,2,3,4,1,2,5,1,2,3,4,5: FIFO faults 9 times with 3 frames, 10 with 4 (Belady, Nelson & Shedler 1969; Silberschatz 10e §10.4.2). */
export const BELADY_PRESET = { refs: [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5], frames: [3, 4] as const };

/** Silberschatz 10e §10.4.2 reference string (3 frames: FIFO 15, OPT 9, LRU 12 faults). */
export const SILBERSCHATZ_REFS = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1];

const natInt = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
const posInt = (n: unknown) => Number.isInteger(n) && (n as number) > 0;

export function validatePaging(p: PagingParams): string[] {
  const out: string[] = [];
  if (!Array.isArray(p.refs) || p.refs.length === 0) out.push('Enter at least one page reference.');
  else if (!p.refs.every(natInt)) out.push('Page numbers must be whole numbers ≥ 0.');
  if (!posInt(p.frames) || p.frames > 64) out.push('Frames must be between 1 and 64.');
  if (!PAGE_ALGOS.includes(p.algo)) out.push(`Unknown algorithm "${p.algo}".`);
  if (p.tlbEntries !== undefined && (!posInt(p.tlbEntries) || p.tlbEntries > 64)) out.push('TLB entries must be between 1 and 64.');
  return out;
}

export function runPaging(params: PagingParams): PagingTrace {
  const problems = validatePaging(params);
  if (problems.length) throw new Error(problems.join('\n'));
  const { refs, frames: n, algo, tlbEntries } = params;

  const frames: (number | null)[] = Array(n).fill(null);
  const loadedAt: number[] = Array(n).fill(-1); // FIFO
  const usedAt: number[] = Array(n).fill(-1); // LRU
  const refBit: (0 | 1)[] = Array(n).fill(0); // Clock
  let hand = 0;
  let tlb: { page: number; frame: number }[] = [];
  let faults = 0, hits = 0, tlbHits = 0;
  const steps: Step<PagingState>[] = [];
  const at = (i: number) => `ref #${i + 1}`;

  refs.forEach((page, i) => {
    let tlbHit: boolean | undefined;
    if (tlbEntries) {
      const e = tlb.findIndex((x) => x.page === page);
      tlbHit = e >= 0;
      if (tlbHit) { tlbHits++; tlb.push(...tlb.splice(e, 1)); } // move to MRU
    }

    let slot = frames.indexOf(page);
    const hit = slot >= 0;
    let victim: number | null = null;
    let summary: string, why: string;

    if (hit) {
      hits++;
      summary = `Page ${page} is in frame ${slot}: hit.`;
      why = {
        fifo: 'FIFO ignores hits: load order alone decides the next victim.',
        lru: `LRU marks page ${page} as most recently used.`,
        opt: 'Optimal ignores hits: it only looks at future references when it must evict.',
        clock: `Clock sets frame ${slot}'s reference bit to 1, giving page ${page} a second chance later.`,
      }[algo];
    } else {
      faults++;
      slot = frames.indexOf(null);
      if (slot >= 0) {
        summary = `Page fault: page ${page} loaded into free frame ${slot}.`;
        why = 'A free frame exists, so nothing is evicted.';
        if (algo === 'clock') hand = (slot + 1) % n;
      } else if (algo === 'clock') {
        const spared: number[] = [];
        while (refBit[hand]) { refBit[hand] = 0; spared.push(frames[hand]!); hand = (hand + 1) % n; }
        slot = hand;
        hand = (hand + 1) % n;
        summary = `Page fault: page ${page} replaces page ${frames[slot]} in frame ${slot}.`;
        why = `Clock sweeps from the hand${spared.length ? `; page${spared.length > 1 ? 's' : ''} ${spared.join(', ')} had reference bit 1, so ${spared.length > 1 ? 'they get' : 'it gets'} a second chance (bit cleared)` : ''}. Page ${frames[slot]} has bit 0 and is evicted.`;
      } else {
        slot = 0;
        if (algo === 'fifo') {
          for (let s = 1; s < n; s++) if (loadedAt[s] < loadedAt[slot]) slot = s;
          why = `FIFO evicts the page loaded earliest: page ${frames[slot]} arrived at ${at(loadedAt[slot])}.`;
        } else if (algo === 'lru') {
          for (let s = 1; s < n; s++) if (usedAt[s] < usedAt[slot]) slot = s;
          why = `LRU evicts the page unused for longest: page ${frames[slot]} was last used at ${at(usedAt[slot])}.`;
        } else {
          const next = frames.map((pg) => { const j = refs.indexOf(pg!, i + 1); return j < 0 ? Infinity : j; });
          for (let s = 1; s < n; s++) if (next[s] > next[slot]) slot = s;
          why = `Optimal evicts the page needed furthest in the future: page ${frames[slot]} is ${next[slot] === Infinity ? 'never used again' : `next used at ${at(next[slot])}`}.`;
        }
        summary = `Page fault: page ${page} replaces page ${frames[slot]} in frame ${slot}.`;
      }
      victim = frames[slot];
      frames[slot] = page;
      loadedAt[slot] = i;
      if (victim !== null) tlb = tlb.filter((x) => x.page !== victim); // evicted page's translation is stale
    }
    usedAt[slot] = i;
    refBit[slot] = 1;

    if (tlbEntries && !tlbHit) {
      tlb.push({ page, frame: slot });
      if (tlb.length > tlbEntries) tlb.shift();
      summary += ` TLB miss: translation cached.`;
    } else if (tlbHit) summary += ' TLB hit.';

    steps.push({
      index: i,
      state: {
        refIndex: i,
        page,
        frames: [...frames],
        hit,
        fault: !hit,
        victim,
        faults,
        hits,
        pageTable: Object.fromEntries(frames.flatMap((pg, s) => (pg === null ? [] : [[pg, s]]))),
        ...(algo === 'clock' && { hand, refBit: [...refBit] }),
        ...(tlbEntries && { tlb: tlb.map((x) => ({ ...x })), tlbHit }),
      },
      explain: { summary, why },
    });
  });

  return {
    steps,
    metrics: { faults, hits, faultRate: faults / refs.length, ...(tlbEntries && { tlbHitRate: tlbHits / refs.length }) },
  };
}

/** Faults for 1..maxFrames frames. A rising segment under FIFO is Belady's anomaly. */
export function faultCurve(refs: number[], algo: PageAlgo, maxFrames: number): number[] {
  return Array.from({ length: maxFrames }, (_, f) => runPaging({ refs, frames: f + 1, algo }).metrics.faults);
}

/** Smallest frame count f where FIFO with f+1 frames faults more than with f. Null if none up to maxFrames. */
export function findBelady(refs: number[], maxFrames: number): { from: number; to: number } | null {
  const c = faultCurve(refs, 'fifo', maxFrames);
  const f = c.findIndex((x, i) => i > 0 && x > c[i - 1]);
  return f < 0 ? null : { from: f, to: f + 1 };
}

/**
 * Seeded reference string. `locality` is the chance of re-referencing one of the last 3 pages,
 * which is what makes LRU beat FIFO on real workloads.
 */
export function generateRefs(p: RefGenParams, rng: Rng = mulberry32(p.seed)): number[] {
  if (!posInt(p.length) || p.length > 1000 || !posInt(p.pages) || !(p.locality >= 0 && p.locality <= 1)) {
    throw new Error('Length 1–1000, pages ≥ 1, locality 0–1.');
  }
  const out: number[] = [];
  for (let i = 0; i < p.length; i++) {
    out.push(out.length && rng() < p.locality ? out[Math.max(0, out.length - randInt(rng, 1, 3))] : randInt(rng, 0, p.pages - 1));
  }
  return out;
}
