import type { Instr, SyncParams } from './types';

const load = (v: string, reg = 'r'): Instr => ({ op: 'load', var: v, reg });
const store = (v: string, reg = 'r'): Instr => ({ op: 'store', var: v, reg });
const add = (n: number, reg = 'r'): Instr => ({ op: 'add', reg, n });
const wait = (sem: string): Instr => ({ op: 'wait', sem });
const signal = (sem: string): Instr => ({ op: 'signal', sem });
const inc = (v: string, n = 1): Instr[] => [load(v), add(n), store(v)];
const rr = (slice: number) => ({ kind: 'roundrobin' as const, slice });

/** counter++ in two threads with no lock. Round robin with a 1-instruction slice interleaves the loads: counter ends at 1. */
export const RACY_COUNTER: SyncParams = {
  threads: [{ id: 'T1', code: inc('counter') }, { id: 'T2', code: inc('counter') }],
  vars: { counter: 0 }, sems: {}, bufs: {}, schedule: rr(1), maxSteps: 100, expect: { var: 'counter', equals: 2 },
};

/** Same threads with the increment inside a binary semaphore. Same schedule, correct result. */
export const LOCKED_COUNTER: SyncParams = {
  ...RACY_COUNTER,
  threads: RACY_COUNTER.threads.map((t) => ({ ...t, code: [wait('mutex'), ...t.code, signal('mutex')] })),
  sems: { mutex: 1 },
};

/**
 * Silberschatz, Operating System Concepts 10e, §6.1: producer runs count++, consumer runs count--, count starts at 5.
 * Any correct execution leaves 5; the book's interleaving leaves 4.
 */
export const COUNT_BOOK: SyncParams = {
  threads: [{ id: 'producer', code: inc('count', 1) }, { id: 'consumer', code: inc('count', -1) }],
  vars: { count: 5 }, sems: {}, bufs: {},
  schedule: { kind: 'explicit', order: ['producer', 'producer', 'consumer', 'consumer', 'producer', 'consumer'] },
  maxSteps: 100, expect: { var: 'count', equals: 5 },
};

/** Bounded buffer with no synchronisation: the producer overruns it, the consumer reads from empty. */
export const PRODUCER_CONSUMER_BROKEN: SyncParams = {
  threads: [{ id: 'producer', code: [{ op: 'put', buf: 'buffer' }], loop: true }, { id: 'consumer', code: [{ op: 'get', buf: 'buffer' }], loop: true }],
  vars: {}, sems: {}, bufs: { buffer: 2 }, schedule: rr(3), maxSteps: 40,
};

/** Silberschatz 10e §7.1.1, bounded buffer with semaphores mutex = 1, empty = n, full = 0. */
export const PRODUCER_CONSUMER: SyncParams = {
  threads: [
    { id: 'producer', code: [wait('empty'), wait('mutex'), { op: 'put', buf: 'buffer' }, signal('mutex'), signal('full')], loop: true },
    { id: 'consumer', code: [wait('full'), wait('mutex'), { op: 'get', buf: 'buffer' }, signal('mutex'), signal('empty')], loop: true },
  ],
  vars: {}, sems: { mutex: 1, empty: 2, full: 0 }, bufs: { buffer: 2 }, schedule: rr(3), maxSteps: 60,
};

/**
 * Silberschatz 10e §7.1.2, first readers-writers problem. Lines 4-7: "if (read_count == 1) wait(rw_mutex)";
 * lines 12-16: "if (read_count == 0) signal(rw_mutex)". jz jumps when the register is 0, so r holds read_count - 1 / read_count.
 */
const reader: Instr[] = [
  wait('mutex'), load('read_count'), add(1), store('read_count'),
  add(-1), { op: 'jz', reg: 'r', to: 7 }, { op: 'jmp', to: 8 }, wait('rw_mutex'),
  signal('mutex'),
  load('data', 'd'), // the read itself
  wait('mutex'), load('read_count'), add(-1), store('read_count'),
  { op: 'jz', reg: 'r', to: 16 }, { op: 'jmp', to: 17 }, signal('rw_mutex'),
  signal('mutex'),
];
const writer: Instr[] = [wait('rw_mutex'), load('data', 'd'), add(1, 'd'), store('data', 'd'), signal('rw_mutex')];

export const READERS_WRITERS: SyncParams = {
  threads: [{ id: 'R1', code: reader }, { id: 'R2', code: reader }, { id: 'W1', code: writer }, { id: 'W2', code: writer }],
  vars: { read_count: 0, data: 0 }, sems: { mutex: 1, rw_mutex: 1 }, bufs: {}, schedule: rr(2), maxSteps: 200,
  expect: { var: 'data', equals: 2 },
};

/** Silberschatz 10e §6.8.3: semaphores S and Q taken in opposite orders deadlock. */
export const OPPOSITE_ORDER: SyncParams = {
  threads: [
    { id: 'P0', code: [wait('S'), wait('Q'), signal('S'), signal('Q')] },
    { id: 'P1', code: [wait('Q'), wait('S'), signal('Q'), signal('S')] },
  ],
  vars: {}, sems: { S: 1, Q: 1 }, bufs: {}, schedule: rr(1), maxSteps: 50,
};

export const SYNC_PRESETS = { RACY_COUNTER, LOCKED_COUNTER, COUNT_BOOK, PRODUCER_CONSUMER_BROKEN, PRODUCER_CONSUMER, READERS_WRITERS, OPPOSITE_ORDER };
