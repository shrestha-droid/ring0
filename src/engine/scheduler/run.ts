import type { Step } from '../core/types';
import type { Algo, Proc, ProcMetrics, SchedulerParams, SchedulerState, SchedulerTrace, Segment } from './types';

const MAX_TICKS = 100_000;

/** Mutable per-process bookkeeping. Never leaves this file; snapshots copy out of it. */
interface Live {
  p: Proc;
  burst: number; // index into p.bursts of the current CPU burst
  remaining: number;
  level: number; // MLFQ
  eff: number; // effective priority after aging
  aged: number; // ticks waited since the last aging bump
  firstRun: number | null;
  completion: number | null;
}

export function algoLabel(algo: Algo): string {
  switch (algo.kind) {
    case 'fcfs': return 'FCFS';
    case 'sjf': return 'SJF';
    case 'srtf': return 'SRTF';
    case 'rr': return `RR (q=${algo.quantum})`;
    case 'priority': return `Priority${algo.preemptive ? ' (preemptive)' : ''}${algo.aging ? ' + aging' : ''}`;
    case 'mlfq': return `MLFQ (${algo.quanta.join('/')})`;
  }
}

const posInt = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
const natInt = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

export function validateProcs(procs: Proc[]): string[] {
  const out: string[] = [];
  if (!Array.isArray(procs) || procs.length === 0) return ['Add at least one process.'];
  const seen = new Set<string>();
  for (const p of procs) {
    const id = String(p?.id ?? '').trim();
    if (!id) out.push('Every process needs a name.');
    else if (seen.has(id)) out.push(`Duplicate process name "${id}".`);
    seen.add(id);
    if (!natInt(p.arrival)) out.push(`${id}: arrival must be a whole number ≥ 0.`);
    if (!natInt(p.priority)) out.push(`${id}: priority must be a whole number ≥ 0.`);
    if (!Array.isArray(p.bursts) || p.bursts.length % 2 === 0) out.push(`${id}: bursts must alternate CPU, I/O, CPU… and start and end with CPU.`);
    else if (!p.bursts.every(posInt)) out.push(`${id}: every burst must be a whole number ≥ 1.`);
  }
  return out;
}

export function validateAlgo(algo: Algo): string[] {
  if (algo.kind === 'rr' && !posInt(algo.quantum)) return ['Quantum must be a whole number ≥ 1.'];
  if (algo.kind === 'mlfq' && (!algo.quanta.length || !algo.quanta.every(posInt))) return ['Every MLFQ quantum must be a whole number ≥ 1.'];
  if (algo.kind === 'mlfq' && algo.boostEvery !== undefined && !posInt(algo.boostEvery)) return ['Boost interval must be a whole number ≥ 1.'];
  if (algo.kind === 'priority' && algo.aging && (!posInt(algo.aging.every) || !posInt(algo.aging.boost))) return ['Aging interval and step must be whole numbers ≥ 1.'];
  return [];
}

/** The number each algorithm minimises when choosing. FCFS/RR use queue order only. */
function key(algo: Algo, l: Live): number {
  switch (algo.kind) {
    case 'sjf':
    case 'srtf': return l.remaining;
    case 'priority': return l.eff;
    case 'mlfq': return l.level;
    default: return 0;
  }
}

const keyName: Partial<Record<Algo['kind'], string>> = { sjf: 'next CPU burst', srtf: 'remaining time', priority: 'priority', mlfq: 'queue level' };

function isPreemptive(algo: Algo) {
  return algo.kind === 'srtf' || algo.kind === 'mlfq' || (algo.kind === 'priority' && algo.preemptive);
}

function quantumOf(algo: Algo, l: Live): number | null {
  if (algo.kind === 'rr') return algo.quantum;
  if (algo.kind === 'mlfq') return algo.quanta[Math.min(l.level, algo.quanta.length - 1)];
  return null;
}

export function runScheduler({ procs, algo, contextSwitchCost = 0 }: SchedulerParams): SchedulerTrace {
  const problems = [...validateProcs(procs), ...validateAlgo(algo)];
  if (!natInt(contextSwitchCost)) problems.push('Context switch cost must be a whole number ≥ 0.');
  if (problems.length) throw new Error(problems.join('\n'));

  const live: Live[] = procs.map((p) => ({
    p, burst: 0, remaining: p.bursts[0], level: 0, eff: p.priority, aged: 0, firstRun: null, completion: null,
  }));
  const name = algoLabel(algo);
  const ready: Live[] = [];
  const blocked: { l: Live; until: number }[] = [];
  const doneIds: string[] = [];
  const occupancy: Segment['who'][] = [];
  const steps: Step<SchedulerState>[] = [];
  let running: Live | null = null;
  let last: Live | null = null; // last process to hold the CPU, for context-switch accounting
  let slice = 0;
  let switchLeft = 0;
  let switches = 0;

  const snapshot = (t: number): SchedulerState => {
    const readyView = algo.kind === 'mlfq' ? [...ready].sort((a, b) => a.level - b.level) : ready; // stable sort keeps FIFO within a level
    const notDone = live.filter((l) => l.completion === null);
    return {
      t,
      running: running?.p.id ?? null,
      switching: switchLeft > 0,
      ready: readyView.map((l) => l.p.id),
      blocked: blocked.map((b) => ({ id: b.l.p.id, until: b.until })),
      done: [...doneIds],
      remaining: Object.fromEntries(notDone.map((l) => [l.p.id, l.remaining])),
      ...(algo.kind === 'mlfq' && { level: Object.fromEntries(notDone.map((l) => [l.p.id, l.level])) }),
      ...(algo.kind === 'priority' && { effPriority: Object.fromEntries(notDone.map((l) => [l.p.id, l.eff])) }),
    };
  };

  for (let t = 0; doneIds.length < live.length; t++) {
    if (t > MAX_TICKS) throw new Error(`Simulation exceeded ${MAX_TICKS} ticks.`);
    const notes: string[] = [];
    let why = '';

    // 1. Aging: everyone who sat in the ready queue through the previous tick.
    if (algo.kind === 'priority' && algo.aging && t > 0) {
      for (const l of ready) {
        if (++l.aged >= algo.aging.every) {
          l.aged = 0;
          const before = l.eff;
          l.eff = Math.max(0, l.eff - algo.aging.boost);
          if (l.eff !== before) notes.push(`${l.p.id} aged: priority ${before} → ${l.eff}`);
        }
      }
    }

    // 2. MLFQ periodic boost.
    if (algo.kind === 'mlfq' && algo.boostEvery && t > 0 && t % algo.boostEvery === 0) {
      for (const l of live) l.level = 0;
      notes.push('Priority boost: every process moves back to Q0');
      why = `MLFQ boosts every ${algo.boostEvery} ticks so long-running jobs can't starve.`;
    }

    // 3. Admissions: arrivals, then I/O returns.
    for (const l of live) if (l.p.arrival === t) { ready.push(l); notes.push(`${l.p.id} arrives`); }
    for (let i = 0; i < blocked.length; ) {
      if (blocked[i].until === t) {
        const { l } = blocked[i];
        blocked.splice(i, 1);
        ready.push(l);
        notes.push(`${l.p.id} finishes I/O`);
      } else i++;
    }

    // 4. Preemption (never mid context switch).
    if (running && switchLeft === 0) {
      const q = quantumOf(algo, running);
      const r: Live = running;
      const better = isPreemptive(algo) ? ready.find((x) => key(algo, x) < key(algo, r)) : undefined;
      if (q !== null && slice >= q) {
        const demote = algo.kind === 'mlfq' && r.level < algo.quanta.length - 1;
        if (demote) r.level++;
        if (ready.length === 0) {
          notes.push(`${r.p.id}'s quantum expired${demote ? `, demoted to Q${r.level}` : ''}, but nothing else is ready so it keeps the CPU`);
          slice = 0;
        } else {
          notes.push(`${r.p.id}'s quantum expired${demote ? `, demoted to Q${r.level}` : ''}`);
          why = `${name}: after ${q} ticks the running process goes to the back of ${algo.kind === 'mlfq' ? `Q${r.level}` : 'the ready queue'}.`;
          running = null;
        }
      } else if (better) {
        notes.push(`${r.p.id} preempted by ${better.p.id}`);
        why = `${name} is preemptive: ${better.p.id}'s ${keyName[algo.kind]} (${key(algo, better)}) beats ${r.p.id}'s (${key(algo, r)}).`;
        running = null;
      }
      if (!running) {
        r.eff = r.p.priority;
        r.aged = 0;
        ready.push(r);
      }
    }

    // 5. Dispatch.
    if (!running && ready.length) {
      let pick = ready[0];
      for (const x of ready) if (key(algo, x) < key(algo, pick)) pick = x;
      ready.splice(ready.indexOf(pick), 1);
      const others = ready.map((x) => `${x.p.id}(${key(algo, x)})`).join(', ');
      if (!why) {
        why = keyName[algo.kind]
          ? `${name} picks the lowest ${keyName[algo.kind]}: ${pick.p.id}(${key(algo, pick)})${others ? ` over ${others}` : ''}.`
          : `${name}: ${pick.p.id} is at the head of the ready queue.`;
      }
      running = pick;
      slice = 0;
      if (last && last !== pick) {
        switches++;
        switchLeft = contextSwitchCost;
        if (contextSwitchCost) notes.push(`context switch ${last.p.id} → ${pick.p.id}`);
      }
      last = pick;
      notes.push(`${pick.p.id} dispatched`);
    }

    // Explanation for a quiet tick.
    if (!why) {
      if (!running) why = blocked.length ? 'Every unfinished process is waiting on I/O or has not arrived.' : 'No process has arrived yet.';
      else if (switchLeft > 0) why = `The OS is saving the old process's registers and loading ${running.p.id}'s; no user work happens.`;
      else if (!isPreemptive(algo) && quantumOf(algo, running) === null) why = `${name} is non-preemptive: ${running.p.id} keeps the CPU until its burst ends.`;
      else if (quantumOf(algo, running) !== null) why = `${running.p.id} has used ${slice} of its ${quantumOf(algo, running)}-tick quantum.`;
      else why = `No ready process has a lower ${keyName[algo.kind]} than ${running.p.id}'s ${key(algo, running)}.`;
    }
    const summary = notes.length ? notes.join('. ') + '.' : running ? (switchLeft > 0 ? 'Context switch in progress.' : `${running.p.id} runs (${running.remaining} left).`) : 'CPU idle.';
    steps.push({ index: steps.length, state: snapshot(t), explain: { summary, why } });

    // 6. Execute one tick.
    if (!running) occupancy.push('idle');
    else if (switchLeft > 0) { switchLeft--; occupancy.push('switch'); }
    else {
      occupancy.push(running.p.id);
      running.firstRun ??= t;
      running.remaining--;
      slice++;
      if (running.remaining === 0) {
        const r = running;
        r.burst++;
        if (r.burst < r.p.bursts.length) {
          blocked.push({ l: r, until: t + 1 + r.p.bursts[r.burst] });
          r.burst++;
          r.remaining = r.p.bursts[r.burst];
        } else {
          r.completion = t + 1;
          doneIds.push(r.p.id);
        }
        r.eff = r.p.priority;
        r.aged = 0;
        running = null;
      }
    }
  }

  // Metrics.
  const makespan = occupancy.length;
  const perProc: Record<string, ProcMetrics> = {};
  for (const l of live) {
    const completion = l.completion!;
    const turnaround = completion - l.p.arrival;
    const work = l.p.bursts.reduce((a, b) => a + b, 0);
    perProc[l.p.id] = { completion, turnaround, waiting: turnaround - work, response: l.firstRun! - l.p.arrival };
  }
  const avg = (f: (m: ProcMetrics) => number) => Object.values(perProc).reduce((a, m) => a + f(m), 0) / live.length;
  const gantt: Segment[] = [];
  occupancy.forEach((who, t) => {
    const lastSeg = gantt[gantt.length - 1];
    if (lastSeg?.who === who) lastSeg.to = t + 1;
    else gantt.push({ from: t, to: t + 1, who });
  });
  const busy = occupancy.filter((w) => w !== 'idle' && w !== 'switch').length;
  const metrics = {
    perProc,
    avgWaiting: avg((m) => m.waiting),
    avgTurnaround: avg((m) => m.turnaround),
    avgResponse: avg((m) => m.response),
    cpuUtilization: busy / makespan,
    throughput: live.length / makespan,
    contextSwitches: switches,
    gantt,
  };

  steps.push({
    index: steps.length,
    state: snapshot(makespan),
    explain: {
      summary: `All ${live.length} processes finished at t=${makespan}.`,
      why: `${name}: average waiting ${fmt(metrics.avgWaiting)}, turnaround ${fmt(metrics.avgTurnaround)}, response ${fmt(metrics.avgResponse)}; CPU busy ${Math.round(metrics.cpuUtilization * 100)}% of the time.`,
    },
  });

  return { steps, metrics };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function compareSchedulers(procs: Proc[], algos: Algo[], contextSwitchCost = 0): SchedulerTrace[] {
  return algos.map((algo) => runScheduler({ procs, algo, contextSwitchCost }));
}
