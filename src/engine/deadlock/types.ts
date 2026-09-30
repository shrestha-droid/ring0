import type { Explanation, ScenarioEnvelope, Trace } from '../core/types';

/** Resource allocation graph. Multi-instance resources supported. */
export interface Rag {
  processes: string[];
  resources: { id: string; instances: number }[];
  /** Request edge P -> R: P is waiting for `count` instances of R. */
  requests: { from: string; to: string; count: number }[];
  /** Assignment edge R -> P: P currently holds `count` instances of R. */
  holds: { from: string; to: string; count: number }[];
  /** Node positions for the UI (drag). Engine ignores them; kept in the scenario so shared links restore layout. */
  layout?: Record<string, { x: number; y: number }>;
}

export interface DeadlockResult {
  deadlocked: string[]; // processes that can never finish (graph reduction, correct for multi-instance)
  /** One wait-for cycle, node ids in order, for highlighting. Null if none. With multi-instance a cycle is necessary, not sufficient. */
  cycle: string[] | null;
  /** Order in which the non-deadlocked processes can finish (the reduction). */
  finishOrder: string[];
  explain: Explanation;
}

/** Banker's algorithm (Dijkstra). All vectors are indexed by resource type. */
export interface BankerState {
  available: number[];
  max: number[][]; // [process][resource]
  allocation: number[][];
}

export interface BankerStep {
  work: number[]; // Work vector BEFORE this process is picked
  picked: string | null; // null on the final verdict step (safe: sequence complete; unsafe: nobody fits)
  need: number[]; // that process's remaining need
  workAfter: number[]; // work + allocation[picked]
  finished: string[];
}

export interface BankerMetrics {
  safe: boolean;
  sequence: string[]; // a safe sequence if safe, else the prefix found before getting stuck
}

export type BankerTrace = Trace<BankerStep, BankerMetrics>;

export interface BankerRequestResult {
  granted: boolean;
  /** Why: exceeds need / exceeds available (must wait) / would be unsafe (denied) / safe (granted). */
  reason: 'exceeds-max' | 'not-available' | 'unsafe' | 'safe';
  /** The safety run on the hypothetical state, for animation. Null when refused before the safety check. */
  trace: BankerTrace | null;
  /** State after the request: the new allocation if granted, else the input unchanged. */
  state: BankerState;
  explain: Explanation;
}

export type DeadlockParams = { kind: 'rag'; rag: Rag } | { kind: 'banker'; state: BankerState; processNames?: string[] };
export type DeadlockScenario = ScenarioEnvelope<'deadlock', DeadlockParams>;

/**
 * detectDeadlock(rag): DeadlockResult
 * checkSafety(state, names?): BankerTrace                    — one step per process picked, plus a verdict step
 * requestResources(state, pid, req, names?): BankerRequestResult
 * diningPhilosophers(n, opts?: { ordered?: boolean }): Rag  — preset: everyone holds left fork, wants right. `ordered` = the resource-ordering fix.
 */
export interface DeadlockApi {
  detectDeadlock(rag: Rag): DeadlockResult;
  checkSafety(state: BankerState, names?: string[]): BankerTrace;
  requestResources(state: BankerState, pid: number, req: number[], names?: string[]): BankerRequestResult;
  diningPhilosophers(n: number, opts?: { ordered?: boolean }): Rag;
}
