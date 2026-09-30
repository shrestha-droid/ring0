import type { Proc } from './types';

const p = (id: string, arrival: number, bursts: number[], priority = 0): Proc => ({ id, arrival, bursts, priority });

/** Silberschatz, Galvin, Gagne, Operating System Concepts 10e, §5.3.1 (FCFS) and §5.3.4 (RR). The convoy effect. */
export const CONVOY = [p('P1', 0, [24]), p('P2', 0, [3]), p('P3', 0, [3])];

/** Silberschatz 10e §5.3.2 (SJF). */
export const SJF_BOOK = [p('P1', 0, [6]), p('P2', 0, [8]), p('P3', 0, [7]), p('P4', 0, [3])];

/** Silberschatz 10e §5.3.2 (preemptive SJF / SRTF). */
export const SRTF_BOOK = [p('P1', 0, [8]), p('P2', 1, [4]), p('P3', 2, [9]), p('P4', 3, [5])];

/** Silberschatz 10e §5.3.3 (priority, lower number = higher priority). */
export const PRIORITY_BOOK = [p('P1', 0, [10], 3), p('P2', 0, [1], 1), p('P3', 0, [2], 4), p('P4', 0, [1], 5), p('P5', 0, [5], 2)];

/**
 * Arpaci-Dusseau, Operating Systems: Three Easy Pieces, ch. 8 (MLFQ), Figure 8.3:
 * a long batch job A, and a short interactive job B arriving at t=100. B starts at top priority and finishes quickly.
 */
export const MLFQ_OSTEP = [p('A', 0, [200]), p('B', 100, [20])];

/** Mixed CPU/I-O workload for the UI's default view. Not from a textbook. */
export const MIXED = [p('P1', 0, [5, 3, 2], 2), p('P2', 1, [3], 1), p('P3', 2, [8], 3), p('P4', 4, [2, 2, 2], 0)];
