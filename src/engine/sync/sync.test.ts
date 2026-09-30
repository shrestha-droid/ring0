import { describe, expect, it } from 'vitest';
import { findViolation, runSync } from './run';
import { COUNT_BOOK, LOCKED_COUNTER, OPPOSITE_ORDER, PRODUCER_CONSUMER, PRODUCER_CONSUMER_BROKEN, RACY_COUNTER, READERS_WRITERS } from './presets';

const last = (p: Parameters<typeof runSync>[0]) => runSync(p).steps.at(-1)!.state;

describe('race conditions', () => {
  // Silberschatz, Operating System Concepts 10e, §6.1: interleaving T0..T5 of count++ / count-- with count = 5
  // leaves count = 4 ("we have arrived at the incorrect state count == 4").
  it('book count++/count-- interleaving gives 4', () => {
    const { steps, metrics } = runSync(COUNT_BOOK);
    expect(steps.map((s) => s.state.vars.count)).toEqual([5, 5, 5, 5, 5, 6, 4]);
    expect(steps[2].state.regs.producer.r).toBe(6); // register1 = register1 + 1 {register1 = 6}
    expect(steps[4].state.regs.consumer.r).toBe(4); // register2 = register2 - 1 {register2 = 4}
    expect(metrics.violations).toEqual([
      "Lost update: consumer overwrote count with 4, erasing producer's write (6).",
      'Wrong result: count should be 5, got 4.',
    ]);
  });

  it('the same interleaving, run serially, is correct', () => {
    const { metrics } = runSync({ ...COUNT_BOOK, schedule: { kind: 'explicit', order: ['producer', 'producer', 'producer', 'consumer', 'consumer', 'consumer'] } });
    expect(metrics).toEqual({ finished: true, deadlocked: false, violations: [] });
  });

  it('racy counter: round robin loses an update; the mutex fixes it', () => {
    expect(last(RACY_COUNTER).vars.counter).toBe(1);
    const fixed = runSync(LOCKED_COUNTER);
    expect(fixed.steps.at(-1)!.state.vars.counter).toBe(2);
    expect(fixed.metrics.violations).toEqual([]);
    expect(fixed.steps[2].explain.summary).toBe('T2: wait(mutex) (blocks)');
  });

  it('search finds the shortest bad interleaving, and proves the fix has none', () => {
    const bad = findViolation(RACY_COUNTER, 10)!;
    expect(bad).toHaveLength(6); // both threads' three instructions: the race needs every one
    expect(last({ ...RACY_COUNTER, schedule: { kind: 'explicit', order: bad } }).vars.counter).toBe(1);
    expect(findViolation(LOCKED_COUNTER, 20)).toBeNull();
  });
});

describe('classic problems', () => {
  it('unsynchronised bounded buffer overflows and underflows', () => {
    expect(runSync(PRODUCER_CONSUMER_BROKEN).metrics.violations[0]).toBe('Buffer overflow: producer put into full buffer (3/2).');
    expect(findViolation(PRODUCER_CONSUMER_BROKEN, 5)).toEqual(['consumer']);
  });

  // Silberschatz 10e §7.1.1: with empty/full/mutex semaphores the buffer never over- or underflows, in any interleaving.
  it('bounded buffer with semaphores is safe in every interleaving', () => {
    const { steps, metrics } = runSync(PRODUCER_CONSUMER);
    expect(metrics.violations).toEqual([]);
    expect(steps.every((s) => s.state.bufs.buffer >= 0 && s.state.bufs.buffer <= 2)).toBe(true);
    expect(findViolation(PRODUCER_CONSUMER, 60)).toBeNull();
  });

  // Silberschatz 10e §7.1.2: writers are exclusive, so two writers never lose an update and every thread finishes.
  it('readers-writers: no lost writes, no deadlock, in any interleaving', () => {
    expect(runSync(READERS_WRITERS).metrics).toEqual({ finished: true, deadlocked: false, violations: [] });
    expect(findViolation(READERS_WRITERS, 60)).toBeNull();
  });

  it('readers-writers without rw_mutex loses a write', () => {
    const noLock = { ...READERS_WRITERS, sems: { ...READERS_WRITERS.sems, rw_mutex: 2 } };
    const bad = findViolation(noLock, 20)!;
    expect(bad).toHaveLength(8); // wait, load, add, store for each writer
    expect(bad.every((t) => t.startsWith('W'))).toBe(true);
    expect(last({ ...noLock, schedule: { kind: 'explicit', order: bad } }).vars.data).toBe(1);
  });

  // Silberschatz 10e §6.8.3: P0 waits S then Q, P1 waits Q then S.
  it('opposite lock order deadlocks', () => {
    const { metrics } = runSync(OPPOSITE_ORDER);
    expect(metrics.deadlocked).toBe(true);
    expect(metrics.violations).toEqual(['Deadlock: P0, P1 are all blocked.']);
    expect(findViolation(OPPOSITE_ORDER, 10)).toEqual(['P0', 'P1', 'P0', 'P1']);
  });
});

describe('vm', () => {
  it('explicit schedules skip threads that cannot run', () => {
    const { steps } = runSync({ ...LOCKED_COUNTER, schedule: { kind: 'explicit', order: ['T1', 'T2', 'T2', 'T1'] } });
    expect(steps.map((s) => s.state.ran)).toEqual([null, 'T1', 'T2', 'T1']);
  });

  it('seeded schedules are reproducible and serialisable', () => {
    const p = { ...READERS_WRITERS, schedule: { kind: 'seeded' as const, seed: 3 } };
    const a = runSync(p);
    expect(runSync(p)).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.metrics.finished).toBe(true);
  });

  it('rejects bad programs', () => {
    expect(() => runSync({ ...RACY_COUNTER, threads: [{ id: 'T1', code: [{ op: 'wait', sem: 'nope' }, { op: 'jmp', to: 9 }] }] })).toThrow(
      'T1 line 0: unknown semaphore "nope".\nT1 line 1: jump target out of range.',
    );
  });
});
