import type { Rng, ScenarioEnvelope, Trace } from '../core/types';

export type PageAlgo = 'fifo' | 'lru' | 'opt' | 'clock';

export interface PagingParams {
  refs: number[]; // page numbers
  frames: number;
  algo: PageAlgo;
  /** Omit for no TLB. The TLB is a small LRU cache of page -> frame sitting in front of the page table. */
  tlbEntries?: number;
}

export interface PagingState {
  refIndex: number;
  page: number;
  frames: (number | null)[]; // frame i holds page or null. Slot positions are stable (a replacement reuses the victim's slot).
  hit: boolean;
  fault: boolean;
  victim: number | null; // page evicted, if any
  faults: number; // cumulative
  hits: number; // cumulative
  /** Page table: resident page -> frame index. Non-resident pages are absent (valid bit = 0). */
  pageTable: Record<number, number>;
  /** Clock only. */
  hand?: number;
  refBit?: (0 | 1)[];
  /** TLB contents, LRU first to MRU last. Present only if tlbEntries set. */
  tlb?: { page: number; frame: number }[];
  tlbHit?: boolean;
}

export interface PagingMetrics {
  faults: number;
  hits: number;
  faultRate: number; // 0..1
  tlbHitRate?: number;
}

export type PagingScenario = ScenarioEnvelope<'memory', PagingParams>;
export type PagingTrace = Trace<PagingState, PagingMetrics>;

export interface RefGenParams {
  seed: number;
  length: number;
  pages: number; // page numbers drawn from 0..pages-1
  /** 0 = uniform random, 1 = strongly local (re-references recent pages). */
  locality: number;
}

/**
 * runPaging(params): PagingTrace                      — one step per reference
 * faultCurve(refs, algo, maxFrames): number[]         — faults for frames = 1..maxFrames (Belady sweep)
 * findBelady(refs, maxFrames): {refs, from, to} | null — smallest frames f where faults(f+1) > faults(f) under FIFO
 * generateRefs(p: RefGenParams, rng?): number[]       — deterministic given seed
 * BELADY_PRESET: { refs: number[]; frames: [3, 4] }   — 1,2,3,4,1,2,5,1,2,3,4,5 : FIFO 9 faults @3, 10 @4 (Silberschatz, OS Concepts)
 */
export interface MemoryApi {
  runPaging(params: PagingParams): PagingTrace;
  faultCurve(refs: number[], algo: PageAlgo, maxFrames: number): number[];
  generateRefs(p: RefGenParams, rng?: Rng): number[];
}
