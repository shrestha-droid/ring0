// Shared contract for every RING0 module. No UI imports, no clock, no unseeded randomness, no IO anywhere in src/engine (purity.test.ts enforces it).

/** Plain-English account of a step. Rendered by the Explain panel; also asserted on in tests. */
export interface Explanation {
  /** What happened, one line. "P2 dispatched." */
  summary: string;
  /** Why the OS/algorithm chose it. "SJF picks the shortest remaining burst among ready: P2(3) < P1(7)." */
  why: string;
}

/** One point on the timeline. `state` is a full immutable snapshot, so scrubbing backwards is an array index. */
export interface Step<S> {
  index: number;
  state: S;
  explain: Explanation;
}

/** Everything a simulator returns. Derived from a scenario, never stored in the URL or the store. */
export interface Trace<S, M> {
  steps: Step<S>[];
  metrics: M;
}

/** A simulator is a pure function: same params in, deep-equal trace out. */
export type Simulate<P, S, M> = (params: P) => Trace<S, M>;

/**
 * What goes in the share link and the JSON export. Versioned so old links keep working.
 * Serialised with JSON -> lz-string -> URL hash (see ARCHITECTURE.md).
 */
export interface ScenarioEnvelope<K extends string, P> {
  v: 1;
  module: K;
  params: P;
}

/** Deterministic randomness for generators. The seed lives in the scenario, so "random" links reproduce. */
export type Rng = () => number; // [0, 1)
