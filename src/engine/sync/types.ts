import type { ScenarioEnvelope, Trace } from '../core/types';

/**
 * A tiny register machine, so "thread interleaving" is literal: the scheduler picks which thread
 * executes ONE instruction next. `counter++` is load/add/store, which is exactly why it races.
 */
export type Instr =
  | { op: 'load'; var: string; reg: string } // reg = shared[var]
  | { op: 'store'; var: string; reg: string } // shared[var] = reg
  | { op: 'set'; reg: string; n: number }
  | { op: 'add'; reg: string; n: number }
  | { op: 'wait'; sem: string } // P: if sem > 0 then sem-- else block
  | { op: 'signal'; sem: string } // V: sem++, wake one waiter (FIFO)
  | { op: 'put'; buf: string } // bounded buffer; overflow is a recorded violation, not a crash
  | { op: 'get'; buf: string } // underflow likewise
  | { op: 'jz'; reg: string; to: number } // jump if reg == 0
  | { op: 'jmp'; to: number };

export interface ThreadDef {
  id: string;
  code: Instr[];
  /** Loop the program forever (producers/consumers) vs. run once (race demo). Bounded by maxSteps either way. */
  loop?: boolean;
}

export type Schedule =
  | { kind: 'explicit'; order: string[] } // user stepping: thread id per step; picks of blocked/finished threads are skipped
  | { kind: 'roundrobin'; slice: number }
  | { kind: 'seeded'; seed: number }; // deterministic pseudo-random interleaving

export interface SyncParams {
  threads: ThreadDef[];
  vars: Record<string, number>;
  sems: Record<string, number>;
  bufs: Record<string, number>; // name -> capacity
  schedule: Schedule;
  maxSteps: number;
  /** Checked when all threads finish. "counter should be 2" turns a race into a visible failure. */
  expect?: { var: string; equals: number };
}

export interface SyncState {
  pcs: Record<string, number>;
  regs: Record<string, Record<string, number>>;
  vars: Record<string, number>;
  sems: Record<string, number>;
  bufs: Record<string, number>; // current fill level
  status: Record<string, 'ready' | 'blocked' | 'done'>;
  waiting: Record<string, string[]>; // sem -> blocked thread ids, FIFO
  ran: string | null; // thread that executed this step (null on the initial state)
  violations: string[]; // cumulative: "buffer overflow", "lost update: expected 2, got 1", ...
  /** Lost-update detection: each store bumps the variable's version; a thread storing after someone else's store since its load clobbers it. */
  versions: Record<string, number>;
  lastWriter: Record<string, string>;
  loadedVersions: Record<string, Record<string, number>>; // thread -> var -> version it loaded
}

export interface SyncMetrics {
  finished: boolean;
  deadlocked: boolean; // all live threads blocked
  violations: string[];
}

export type SyncTrace = Trace<SyncState, SyncMetrics>;
export type SyncScenario = ScenarioEnvelope<'sync', SyncParams>;

/**
 * runSync(params): SyncTrace                          — step 0 is the initial state, then one step per instruction executed
 * findViolation(params, maxDepth): string[] | null   — breadth-first over all interleavings; returns the shortest `order` that violates `expect`
 *                                                      (this is how the UI offers "show me a bad interleaving" in one click)
 * PRESETS: racyCounter, lockedCounter (mutex semaphore), producerConsumer (empty/full/mutex), readersWriters
 */
export interface SyncApi {
  runSync(params: SyncParams): SyncTrace;
  findViolation(params: SyncParams, maxDepth: number): string[] | null;
}
