import { describe, expect, it } from 'vitest';
import { compareSchedulers, runScheduler, validateProcs } from './run';
import { CONVOY, MIXED, MLFQ_OSTEP, PRIORITY_BOOK, SJF_BOOK, SRTF_BOOK } from './presets';
import type { Proc, SchedulerParams } from './types';

const waits = (m: ReturnType<typeof runScheduler>['metrics']) => Object.fromEntries(Object.entries(m.perProc).map(([k, v]) => [k, v.waiting]));

describe('textbook examples', () => {
  // Silberschatz, Operating System Concepts 10e, §5.3.1: Gantt P1 0-24, P2 24-27, P3 27-30; avg wait (0+24+27)/3 = 17.
  it('FCFS convoy', () => {
    const { metrics } = runScheduler({ procs: CONVOY, algo: { kind: 'fcfs' } });
    expect(metrics.gantt).toEqual([
      { from: 0, to: 24, who: 'P1' },
      { from: 24, to: 27, who: 'P2' },
      { from: 27, to: 30, who: 'P3' },
    ]);
    expect(metrics.avgWaiting).toBe(17);
  });

  // Silberschatz 10e §5.3.1: same processes in order P2, P3, P1 -> avg wait (6+0+3)/3 = 3.
  it('FCFS order matters', () => {
    const { metrics } = runScheduler({ procs: [CONVOY[1], CONVOY[2], CONVOY[0]], algo: { kind: 'fcfs' } });
    expect(metrics.avgWaiting).toBe(3);
  });

  // Silberschatz 10e §5.3.2: order P4, P1, P3, P2; waits P1=3, P2=16, P3=9, P4=0; avg 7.
  it('SJF', () => {
    const { metrics } = runScheduler({ procs: SJF_BOOK, algo: { kind: 'sjf' } });
    expect(waits(metrics)).toEqual({ P1: 3, P2: 16, P3: 9, P4: 0 });
    expect(metrics.avgWaiting).toBe(7);
  });

  // Silberschatz 10e §5.3.2: Gantt P1 0-1, P2 1-5, P4 5-10, P1 10-17, P3 17-26; avg wait 26/4 = 6.5.
  it('SRTF', () => {
    const { metrics } = runScheduler({ procs: SRTF_BOOK, algo: { kind: 'srtf' } });
    expect(metrics.gantt.map((s) => [s.who, s.from, s.to])).toEqual([
      ['P1', 0, 1], ['P2', 1, 5], ['P4', 5, 10], ['P1', 10, 17], ['P3', 17, 26],
    ]);
    expect(metrics.avgWaiting).toBe(6.5);
  });

  // Silberschatz 10e §5.3.3: order P2, P5, P1, P3, P4; avg wait 41/5 = 8.2.
  it('Priority (non-preemptive)', () => {
    const { metrics } = runScheduler({ procs: PRIORITY_BOOK, algo: { kind: 'priority', preemptive: false } });
    expect(metrics.gantt.map((s) => s.who)).toEqual(['P2', 'P5', 'P1', 'P3', 'P4']);
    expect(metrics.avgWaiting).toBeCloseTo(8.2);
  });

  // Silberschatz 10e §5.3.4: q=4. Gantt P1 0-4, P2 4-7, P3 7-10, P1 10-30; waits P1=6, P2=4, P3=7; avg 17/3 ≈ 5.66.
  it('Round Robin q=4', () => {
    const { metrics } = runScheduler({ procs: CONVOY, algo: { kind: 'rr', quantum: 4 } });
    expect(metrics.gantt.map((s) => [s.who, s.from, s.to])).toEqual([
      ['P1', 0, 4], ['P2', 4, 7], ['P3', 7, 10], ['P1', 10, 30],
    ]);
    expect(waits(metrics)).toEqual({ P1: 6, P2: 4, P3: 7 });
    expect(metrics.avgWaiting).toBeCloseTo(17 / 3);
    expect(metrics.perProc.P2.response).toBe(4);
  });

  // Arpaci-Dusseau, OSTEP ch. 8, Figure 8.3 (3 queues, 10 ms quantum each): B arrives at 100, preempts A at the
  // bottom queue and runs to completion; B's turnaround is its own 20 ms.
  it('MLFQ: interactive job preempts demoted batch job', () => {
    const { steps, metrics } = runScheduler({ procs: MLFQ_OSTEP, algo: { kind: 'mlfq', quanta: [10, 10, 10] } });
    expect(steps[99].state.level!.A).toBe(2); // A sank to the bottom before B arrived
    expect(metrics.perProc.B).toMatchObject({ response: 0, turnaround: 20, completion: 120 });
    expect(metrics.perProc.A.completion).toBe(220);
  });
});

describe('behaviour', () => {
  // Hand-computed: FCFS, P1 = CPU 2, I/O 3, CPU 2; P2 = CPU 4.
  // P1 0-2, P2 2-6 (P1 back from I/O at 5, waits), P1 6-8. P1 wait = 8 - 4 cpu - 3 io = 1.
  it('I/O bursts block and return', () => {
    const { steps, metrics } = runScheduler({ procs: [{ id: 'P1', arrival: 0, bursts: [2, 3, 2], priority: 0 }, { id: 'P2', arrival: 0, bursts: [4], priority: 0 }], algo: { kind: 'fcfs' } });
    expect(metrics.gantt.map((s) => [s.who, s.from, s.to])).toEqual([['P1', 0, 2], ['P2', 2, 6], ['P1', 6, 8]]);
    expect(steps[3].state.blocked).toEqual([{ id: 'P1', until: 5 }]);
    expect(metrics.perProc.P1.waiting).toBe(1);
    expect(metrics.cpuUtilization).toBe(1);
  });

  it('idle gaps lower utilisation', () => {
    const { metrics } = runScheduler({ procs: [{ id: 'P1', arrival: 0, bursts: [2, 3, 2], priority: 0 }], algo: { kind: 'fcfs' } });
    expect(metrics.gantt.map((s) => s.who)).toEqual(['P1', 'idle', 'P1']);
    expect(metrics.cpuUtilization).toBe(4 / 7);
  });

  it('context switch cost is charged between different processes only', () => {
    const { metrics } = runScheduler({ procs: [{ id: 'A', arrival: 0, bursts: [2], priority: 0 }, { id: 'B', arrival: 0, bursts: [2], priority: 0 }], algo: { kind: 'fcfs' }, contextSwitchCost: 1 });
    expect(metrics.gantt.map((s) => s.who)).toEqual(['A', 'switch', 'B']);
    expect(metrics.contextSwitches).toBe(1);
    expect(metrics.cpuUtilization).toBe(4 / 5);
  });

  it('aging lets a starving low-priority process run', () => {
    // Without aging, L (priority 9) waits for every high-priority arrival; with aging it climbs past new arrivals.
    const procs: Proc[] = [{ id: 'L', arrival: 0, bursts: [2], priority: 9 }];
    for (let i = 0; i < 10; i++) procs.push({ id: `H${i}`, arrival: i * 3, bursts: [3], priority: 1 });
    const plain = runScheduler({ procs, algo: { kind: 'priority', preemptive: true } });
    const aged = runScheduler({ procs, algo: { kind: 'priority', preemptive: true, aging: { every: 2, boost: 1 } } });
    expect(plain.metrics.perProc.L.completion).toBe(32);
    expect(aged.metrics.perProc.L.completion).toBeLessThan(plain.metrics.perProc.L.completion);
    expect(aged.steps.some((s) => s.explain.summary.includes('L aged'))).toBe(true);
  });

  it('explains decisions with the numbers it used', () => {
    const { steps } = runScheduler({ procs: SJF_BOOK, algo: { kind: 'sjf' } });
    expect(steps[0].explain.why).toBe('SJF picks the lowest next CPU burst: P4(3) over P1(6), P2(8), P3(7).');
    expect(steps.at(-1)!.explain.summary).toBe('All 4 processes finished at t=24.');
  });

  it('is deterministic and serialisable', () => {
    const params: SchedulerParams = { procs: MIXED, algo: { kind: 'mlfq', quanta: [2, 4, 8], boostEvery: 10 } };
    const a = runScheduler(params);
    expect(runScheduler(JSON.parse(JSON.stringify(params)))).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('compare mode runs every algorithm on the same workload', () => {
    const [fcfs, sjf, rr] = compareSchedulers(SJF_BOOK, [{ kind: 'fcfs' }, { kind: 'sjf' }, { kind: 'rr', quantum: 2 }]);
    expect(sjf.metrics.avgWaiting).toBeLessThan(fcfs.metrics.avgWaiting);
    expect(rr.metrics.gantt.at(-1)!.to).toBe(24);
  });

  it('rejects bad input with readable messages', () => {
    expect(validateProcs([{ id: 'P1', arrival: -1, bursts: [2, 3], priority: 0 }, { id: 'P1', arrival: 0, bursts: [0], priority: 0 }])).toEqual([
      'P1: arrival must be a whole number ≥ 0.',
      'P1: bursts must alternate CPU, I/O, CPU… and start and end with CPU.',
      'Duplicate process name "P1".',
      'P1: every burst must be a whole number ≥ 1.',
    ]);
    expect(() => runScheduler({ procs: SJF_BOOK, algo: { kind: 'rr', quantum: 0 } })).toThrow('Quantum');
  });
});
