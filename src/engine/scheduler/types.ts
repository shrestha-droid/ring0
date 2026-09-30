import type { ScenarioEnvelope, Trace } from '../core/types';

export type Algo =
  | { kind: 'fcfs' }
  | { kind: 'sjf' } // non-preemptive
  | { kind: 'srtf' } // preemptive SJF
  | { kind: 'rr'; quantum: number }
  | {
      kind: 'priority';
      preemptive: boolean;
      /** Every `every` ticks spent waiting in ready, priority improves by `boost` (lower number = higher priority). */
      aging?: { every: number; boost: number };
    }
  | {
      kind: 'mlfq';
      /** quanta[i] is level i's time slice; last level is FCFS-like (its quantum is used as-is). Level 0 is highest. */
      quanta: number[];
      /** Move everything back to level 0 every N ticks (anti-starvation). Omit for no boost. */
      boostEvery?: number;
    };

export interface Proc {
  id: string;
  arrival: number;
  /** Alternating CPU, I/O, CPU, ... Must start and end with a CPU burst, so odd length. [5] = pure CPU; [3,2,4] = CPU 3, I/O 2, CPU 4. */
  bursts: number[];
  /** Lower number = higher priority (textbook convention). Ignored by non-priority algos. */
  priority: number;
}

export interface SchedulerParams {
  procs: Proc[];
  algo: Algo;
  /** Ticks lost on every switch between two different processes. Textbook examples use 0 (default). */
  contextSwitchCost?: number;
}

/**
 * Determinism rules:
 * - Within a tick: aging, then new arrivals (in `procs` order), then I/O returns, then a preempted process re-enters the ready queue.
 *   (So a process arriving at t queues ahead of the one preempted at t, the usual textbook convention.)
 * - Ties in any selection key go to whoever has been in the ready queue longest.
 */

export interface SchedulerState {
  t: number; // state at the START of tick t (after arrivals/unblocks for t are applied)
  running: string | null; // null = idle, or mid context switch
  switching: boolean; // true while paying contextSwitchCost
  ready: string[]; // in queue order (for MLFQ: highest level first, then queue order)
  blocked: { id: string; until: number }[]; // doing I/O
  done: string[];
  remaining: Record<string, number>; // remaining time in the CURRENT cpu burst
  level?: Record<string, number>; // MLFQ only
  effPriority?: Record<string, number>; // priority algo with aging only
}

/** A Gantt bar. Consecutive ticks of the same occupant merge. */
export interface Segment {
  from: number;
  to: number; // exclusive
  who: string | 'idle' | 'switch';
}

export interface ProcMetrics {
  completion: number;
  turnaround: number; // completion - arrival
  waiting: number; // turnaround - total cpu - total io   (time spent in the ready queue)
  response: number; // first dispatch - arrival
}

export interface SchedulerMetrics {
  perProc: Record<string, ProcMetrics>;
  avgWaiting: number;
  avgTurnaround: number;
  avgResponse: number;
  cpuUtilization: number; // busy ticks / makespan, 0..1, context switches count as not busy
  throughput: number; // processes / tick over the makespan
  contextSwitches: number;
  gantt: Segment[];
}

export type SchedulerScenario = ScenarioEnvelope<'scheduler', SchedulerParams>;
export type SchedulerTrace = Trace<SchedulerState, SchedulerMetrics>;

/**
 * runScheduler(params): SchedulerTrace           — one step per tick
 * compareSchedulers(procs, algos): SchedulerTrace[]  — same workload, one trace per algo (compare mode)
 * validateProcs(procs): string[]                 — human-readable problems; the UI blocks Run on non-empty
 */
export interface SchedulerApi {
  runScheduler(params: SchedulerParams): SchedulerTrace;
  compareSchedulers(procs: Proc[], algos: Algo[], contextSwitchCost?: number): SchedulerTrace[];
  validateProcs(procs: Proc[]): string[];
}
