import type { Step } from '../core/types';
import type { BankerRequestResult, BankerState, BankerStep, BankerTrace, DeadlockResult, Rag } from './types';

const natInt = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
const posInt = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
const vec = (v: number[]) => `(${v.join(', ')})`;
const leq = (a: number[], b: number[]) => a.every((x, i) => x <= b[i]);
const add = (a: number[], b: number[]) => a.map((x, i) => x + b[i]);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');

// ---------------------------------------------------------------- resource allocation graph

export function validateRag(rag: Rag): string[] {
  const out: string[] = [];
  const ids = [...rag.processes, ...rag.resources.map((r) => r.id)];
  if (!rag.processes.length) out.push('Add at least one process.');
  if (new Set(ids).size !== ids.length || ids.some((x) => !String(x).trim())) out.push('Every process and resource needs a unique name.');
  for (const r of rag.resources) if (!posInt(r.instances)) out.push(`${r.id}: instances must be a whole number ≥ 1.`);
  const isP = new Set(rag.processes), isR = new Map(rag.resources.map((r) => [r.id, r]));
  for (const e of rag.requests) if (!isP.has(e.from) || !isR.has(e.to) || !posInt(e.count)) out.push(`Bad request edge ${e.from} → ${e.to}.`);
  for (const e of rag.holds) if (!isR.has(e.from) || !isP.has(e.to) || !posInt(e.count)) out.push(`Bad assignment edge ${e.from} → ${e.to}.`);
  for (const r of rag.resources) {
    const held = rag.holds.filter((e) => e.from === r.id).reduce((a, e) => a + e.count, 0);
    if (held > r.instances) out.push(`${r.id} has ${r.instances} instance${r.instances > 1 ? 's' : ''} but ${held} are assigned.`);
  }
  return out;
}

/**
 * Deadlock detection by graph reduction (Silberschatz 10e §8.7.2), which is exact for multi-instance resources:
 * repeatedly let any process whose outstanding requests fit in what's free finish and release everything.
 * Whoever is left over is deadlocked. A cycle is found separately, only to draw it.
 */
export function detectDeadlock(rag: Rag): DeadlockResult {
  const problems = validateRag(rag);
  if (problems.length) throw new Error(problems.join('\n'));
  const R = rag.resources.map((r) => r.id);
  const row = (edges: Rag['requests'], p: string, dir: 'from' | 'to') =>
    R.map((r) => edges.filter((e) => e[dir] === p && e[dir === 'from' ? 'to' : 'from'] === r).reduce((a, e) => a + e.count, 0));
  const alloc = Object.fromEntries(rag.processes.map((p) => [p, row(rag.holds, p, 'to')]));
  const req = Object.fromEntries(rag.processes.map((p) => [p, row(rag.requests, p, 'from')]));
  let work = rag.resources.map((r, i) => r.instances - rag.processes.reduce((a, p) => a + alloc[p][i], 0));

  // A process holding nothing can't be part of a deadlock (book's initial Finish[i] = true when Allocation_i = 0).
  const finishOrder: string[] = [];
  const done = new Set(rag.processes.filter((p) => alloc[p].every((x) => x === 0)));
  for (let progress = true; progress; ) {
    progress = false;
    for (const p of rag.processes) {
      if (!done.has(p) && leq(req[p], work)) {
        work = add(work, alloc[p]);
        done.add(p);
        finishOrder.push(p);
        progress = true;
      }
    }
  }
  const deadlocked = rag.processes.filter((p) => !done.has(p));
  const cycle = findCycle(rag, deadlocked);
  const cyc = cycle && [...cycle, cycle[0]].join(' → ');
  const need = (p: string) => R.filter((_, i) => req[p][i]).join(', ');

  const explain = deadlocked.length
    ? {
        summary: `Deadlock: ${list(deadlocked)} can never finish.`,
        why: `${finishOrder.length ? `Even after ${list(finishOrder)} finish and release everything, ` : 'Nothing can be released, so '}the free resources can't satisfy ${deadlocked.map((p) => `${p} (waiting on ${need(p)})`).join(', ')}.${cyc ? ` They wait on each other in a cycle: ${cyc}.` : ''}`,
      }
    : cyc
      ? {
          summary: 'Cycle, but no deadlock.',
          why: `${cyc} is a cycle, but some of its resources have several instances. A cycle is necessary but not sufficient: processes can still finish in the order ${list(finishOrder)}, releasing what the others need.`,
        }
      : {
          summary: 'No deadlock.',
          why: finishOrder.length ? `No cycle in the graph; processes can finish in the order ${list(finishOrder)}.` : 'No process is holding anything, so nothing can be stuck.',
        };
  return { deadlocked, cycle, finishOrder, explain };
}

/** First cycle found by DFS over P→R (request) and R→P (hold) edges, starting from deadlocked processes when there are any. */
function findCycle(rag: Rag, preferred: string[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of [...rag.requests, ...rag.holds]) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = finished
  const stack: string[] = [];
  const dfs = (u: string): string[] | null => {
    state.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (state.get(v) === 1) return stack.slice(stack.indexOf(v));
      if (!state.has(v)) { const c = dfs(v); if (c) return c; }
    }
    stack.pop();
    state.set(u, 2);
    return null;
  };
  for (const start of [...preferred, ...rag.processes]) if (!state.has(start)) { const c = dfs(start); if (c) return c; }
  return null;
}

// ---------------------------------------------------------------- banker's algorithm

export function validateBanker(s: BankerState): string[] {
  const m = s.available?.length;
  if (!m || !s.max?.length || s.max.length !== s.allocation?.length) return ['Max and Allocation need one row per process and at least one resource.'];
  const out: string[] = [];
  const rows = [s.available, ...s.max, ...s.allocation];
  if (rows.some((r) => r.length !== m)) out.push(`Every row needs ${m} resource columns.`);
  else if (!rows.flat().every(natInt)) out.push('Every entry must be a whole number ≥ 0.');
  else s.allocation.forEach((a, i) => !leq(a, s.max[i]) && out.push(`Process ${i} holds more than its declared max.`));
  return out;
}

const defaultNames = (n: number) => Array.from({ length: n }, (_, i) => `P${i}`);

/**
 * Safety algorithm (Silberschatz 10e §8.6.3.1). Each round scans onward from the last process picked and takes the
 * first one whose Need fits in Work, so the animation moves around the table the way you'd do it by hand.
 */
export function checkSafety(state: BankerState, names = defaultNames(state.max.length)): BankerTrace {
  const problems = validateBanker(state);
  if (problems.length) throw new Error(problems.join('\n'));
  const n = state.max.length;
  const need = state.max.map((row, i) => sub(row, state.allocation[i]));
  let work = [...state.available];
  const finished: string[] = [];
  const done = Array(n).fill(false);
  const steps: Step<BankerStep>[] = [];
  let from = 0;

  while (finished.length < n) {
    let i = -1;
    for (let k = 0; k < n; k++) {
      const j = (from + k) % n;
      if (!done[j] && leq(need[j], work)) { i = j; break; }
    }
    if (i < 0) break;
    const workAfter = add(work, state.allocation[i]);
    done[i] = true;
    finished.push(names[i]);
    steps.push({
      index: steps.length,
      state: { work, picked: names[i], need: need[i], workAfter, finished: [...finished] },
      explain: {
        summary: `${names[i]} can finish.`,
        why: `${names[i]} needs at most ${vec(need[i])} more, which fits in Work ${vec(work)}. When it finishes it releases its allocation ${vec(state.allocation[i])}, so Work becomes ${vec(workAfter)}.`,
      },
    });
    work = workAfter;
    from = i + 1;
  }

  const safe = finished.length === n;
  const stuck = names.filter((_, i) => !done[i]);
  steps.push({
    index: steps.length,
    state: { work, picked: null, need: [], workAfter: work, finished: [...finished] },
    explain: safe
      ? { summary: `Safe. Sequence ⟨${finished.join(', ')}⟩.`, why: 'Every process can get its maximum claim and finish in this order, so the OS can never be forced into deadlock from here.' }
      : {
          summary: `Unsafe: ${stuck.join(', ')} might never finish.`,
          why: `Work is ${vec(work)} but ${stuck.map((p) => `${p} may still need ${vec(need[names.indexOf(p)])}`).join(', ')}. If they all ask for their maximum, nobody can proceed. Unsafe does not mean deadlocked yet, only that the OS can no longer guarantee avoiding it.`,
        },
  });
  return { steps, metrics: { safe, sequence: finished } };
}

/** Resource-request algorithm (Silberschatz 10e §8.6.3.2): pretend to grant, keep it only if the result is safe. */
export function requestResources(state: BankerState, pid: number, req: number[], names = defaultNames(state.max.length)): BankerRequestResult {
  const problems = validateBanker(state);
  if (!Number.isInteger(pid) || pid < 0 || pid >= state.max.length) problems.push('Pick a process.');
  if (req.length !== state.available.length || !req.every(natInt)) problems.push(`Request needs ${state.available.length} whole numbers ≥ 0.`);
  if (problems.length) throw new Error(problems.join('\n'));
  const p = names[pid];
  const need = sub(state.max[pid], state.allocation[pid]);

  if (!leq(req, need)) {
    return { granted: false, reason: 'exceeds-max', trace: null, state, explain: { summary: `${p}'s request is an error.`, why: `${p} asked for ${vec(req)} but declared it would only ever need ${vec(need)} more. A process can't exceed its maximum claim.` } };
  }
  if (!leq(req, state.available)) {
    return { granted: false, reason: 'not-available', trace: null, state, explain: { summary: `${p} must wait.`, why: `${p} asked for ${vec(req)} but only ${vec(state.available)} is free.` } };
  }
  const next: BankerState = {
    available: sub(state.available, req),
    max: state.max,
    allocation: state.allocation.map((row, i) => (i === pid ? add(row, req) : row)),
  };
  const trace = checkSafety(next, names);
  return trace.metrics.safe
    ? { granted: true, reason: 'safe', trace, state: next, explain: { summary: `Granted ${vec(req)} to ${p}.`, why: `After granting, the state is still safe: ⟨${trace.metrics.sequence.join(', ')}⟩.` } }
    : { granted: false, reason: 'unsafe', trace, state, explain: { summary: `${p} must wait, even though ${vec(req)} is free.`, why: 'Granting it would leave the system in an unsafe state, so the banker refuses and the process waits.' } };
}
