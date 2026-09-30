import type { Explanation, Step } from '../core/types';
import { mulberry32 } from '../core/rng';
import type { Instr, SyncParams, SyncState, SyncTrace } from './types';

/** Human form of an instruction, shown in the thread lanes and used in explanations. */
export function formatInstr(i: Instr): string {
  switch (i.op) {
    case 'load': return `${i.reg} = ${i.var}`;
    case 'store': return `${i.var} = ${i.reg}`;
    case 'set': return `${i.reg} = ${i.n}`;
    case 'add': return `${i.reg} = ${i.reg} ${i.n < 0 ? '-' : '+'} ${Math.abs(i.n)}`;
    case 'wait': return `wait(${i.sem})`;
    case 'signal': return `signal(${i.sem})`;
    case 'put': return `put(${i.buf})`;
    case 'get': return `get(${i.buf})`;
    case 'jz': return `if ${i.reg} == 0 goto ${i.to}`;
    case 'jmp': return `goto ${i.to}`;
  }
}

export function validateSync(p: SyncParams): string[] {
  const out: string[] = [];
  const ids = p.threads?.map((t) => t.id) ?? [];
  if (!ids.length) out.push('Add at least one thread.');
  if (new Set(ids).size !== ids.length || ids.some((x) => !String(x).trim())) out.push('Every thread needs a unique name.');
  if (!Number.isInteger(p.maxSteps) || p.maxSteps < 1 || p.maxSteps > 10_000) out.push('Max steps must be between 1 and 10000.');
  for (const [name, v] of [...Object.entries(p.sems), ...Object.entries(p.bufs)]) if (!Number.isInteger(v) || v < 0) out.push(`${name} must start at a whole number ≥ 0.`);
  for (const t of p.threads ?? []) {
    if (!t.code.length) out.push(`${t.id} has no instructions.`);
    t.code.forEach((i, pc) => {
      const where = `${t.id} line ${pc}`;
      if ((i.op === 'load' || i.op === 'store') && !(i.var in p.vars)) out.push(`${where}: unknown variable "${i.var}".`);
      if ((i.op === 'wait' || i.op === 'signal') && !(i.sem in p.sems)) out.push(`${where}: unknown semaphore "${i.sem}".`);
      if ((i.op === 'put' || i.op === 'get') && !(i.buf in p.bufs)) out.push(`${where}: unknown buffer "${i.buf}".`);
      if ((i.op === 'jz' || i.op === 'jmp') && !(Number.isInteger(i.to) && i.to >= 0 && i.to <= t.code.length)) out.push(`${where}: jump target out of range.`);
    });
  }
  if (p.expect && !(p.expect.var in p.vars)) out.push(`Expectation refers to unknown variable "${p.expect.var}".`);
  return out;
}

export function initialState(p: SyncParams): SyncState {
  const regsOf = (code: Instr[]) => Object.fromEntries(code.flatMap((i) => ('reg' in i ? [[i.reg, 0]] : [])));
  return {
    pcs: Object.fromEntries(p.threads.map((t) => [t.id, 0])),
    regs: Object.fromEntries(p.threads.map((t) => [t.id, regsOf(t.code)])),
    vars: { ...p.vars },
    sems: { ...p.sems },
    bufs: Object.fromEntries(Object.keys(p.bufs).map((b) => [b, 0])),
    status: Object.fromEntries(p.threads.map((t) => [t.id, 'ready' as const])),
    waiting: Object.fromEntries(Object.keys(p.sems).map((s) => [s, [] as string[]])),
    ran: null,
    violations: [],
    versions: Object.fromEntries(Object.keys(p.vars).map((v) => [v, 0])),
    lastWriter: {},
    loadedVersions: Object.fromEntries(p.threads.map((t) => [t.id, {}])),
  };
}

export const runnable = (s: SyncState) => Object.keys(s.status).filter((t) => s.status[t] === 'ready');

/** Execute one instruction of thread `tid`. Pure: returns a new state. The caller guarantees `tid` is runnable. */
export function exec(p: SyncParams, prev: SyncState, tid: string): { state: SyncState; explain: Explanation } {
  const s = structuredClone(prev);
  const code = p.threads.find((t) => t.id === tid)!.code;
  const loops = p.threads.find((t) => t.id === tid)!.loop;
  const pc = s.pcs[tid];
  const ins = code[pc];
  const regs = s.regs[tid];
  const moveTo = (who: string, to: number) => {
    const c = p.threads.find((t) => t.id === who)!;
    if (to < c.code.length) s.pcs[who] = to;
    else if (c.loop) s.pcs[who] = 0;
    else { s.pcs[who] = c.code.length; s.status[who] = 'done'; }
  };
  let next = pc + 1;
  let summary = `${tid}: ${formatInstr(ins)}`;
  let why: string;

  switch (ins.op) {
    case 'load':
      regs[ins.reg] = s.vars[ins.var];
      s.loadedVersions[tid][ins.var] = s.versions[ins.var];
      why = `${tid} copies shared ${ins.var} (${s.vars[ins.var]}) into its private register ${ins.reg}. Until it stores, other threads can change ${ins.var} behind its back.`;
      break;
    case 'store': {
      const loaded = s.loadedVersions[tid][ins.var];
      const other = s.lastWriter[ins.var];
      why = `${tid} writes ${regs[ins.reg]} to shared ${ins.var}.`;
      if (loaded !== undefined && loaded !== s.versions[ins.var] && other && other !== tid) {
        const msg = `Lost update: ${tid} overwrote ${ins.var} with ${regs[ins.reg]}, erasing ${other}'s write (${s.vars[ins.var]}).`;
        s.violations.push(msg);
        why = `${msg} ${tid} read ${ins.var} before ${other} stored to it, so ${tid}'s value is computed from a stale copy.`;
      }
      s.vars[ins.var] = regs[ins.reg];
      s.versions[ins.var]++;
      s.lastWriter[ins.var] = tid;
      delete s.loadedVersions[tid][ins.var];
      break;
    }
    case 'set':
      regs[ins.reg] = ins.n;
      why = `Private to ${tid}; shared memory is untouched.`;
      break;
    case 'add': {
      const before = regs[ins.reg];
      regs[ins.reg] += ins.n;
      why = `${tid} computes ${before} ${ins.n < 0 ? '-' : '+'} ${Math.abs(ins.n)} = ${regs[ins.reg]} in its own register; shared memory is untouched.`;
      break;
    }
    case 'wait':
      if (s.sems[ins.sem] > 0) {
        s.sems[ins.sem]--;
        why = `${ins.sem} was ${s.sems[ins.sem] + 1} > 0, so ${tid} decrements it to ${s.sems[ins.sem]} and continues.`;
      } else {
        s.status[tid] = 'blocked';
        s.waiting[ins.sem].push(tid);
        next = pc; // resumes past the wait when signalled
        summary += ' (blocks)';
        why = `${ins.sem} is 0, so ${tid} sleeps in ${ins.sem}'s wait queue instead of busy-waiting.`;
      }
      break;
    case 'signal': {
      const woken = s.waiting[ins.sem].shift();
      if (woken) {
        s.status[woken] = 'ready';
        moveTo(woken, s.pcs[woken] + 1);
        summary += ` (wakes ${woken})`;
        why = `${woken} was waiting on ${ins.sem}, so the signal goes straight to it: ${woken} wakes up past its wait and ${ins.sem} stays ${s.sems[ins.sem]}.`;
      } else {
        s.sems[ins.sem]++;
        why = `Nobody is waiting on ${ins.sem}, so it goes up to ${s.sems[ins.sem]}.`;
      }
      break;
    }
    case 'put':
    case 'get': {
      const cap = p.bufs[ins.buf];
      s.bufs[ins.buf] += ins.op === 'put' ? 1 : -1;
      const fill = s.bufs[ins.buf];
      why = `${ins.buf} now holds ${fill} of ${cap}.`;
      if (fill > cap) s.violations.push(`Buffer overflow: ${tid} put into full ${ins.buf} (${fill}/${cap}).`);
      if (fill < 0) s.violations.push(`Buffer underflow: ${tid} took from empty ${ins.buf}.`);
      if (fill > cap || fill < 0) why = `${s.violations.at(-1)} Nothing stopped it: this is what the semaphores are for.`;
      break;
    }
    case 'jz':
      if (regs[ins.reg] === 0) next = ins.to;
      why = `${ins.reg} is ${regs[ins.reg]}, so ${regs[ins.reg] === 0 ? `${tid} jumps to line ${ins.to}` : 'it falls through'}.`;
      break;
    case 'jmp':
      next = ins.to;
      why = `Unconditional jump to line ${ins.to}.`;
      break;
  }

  if (s.status[tid] === 'ready') moveTo(tid, next);
  if (loops && s.status[tid] === 'ready' && next >= code.length) summary += ' (loops)';
  s.ran = tid;

  const live = Object.keys(s.status).filter((t) => s.status[t] !== 'done');
  if (!live.length && p.expect && s.vars[p.expect.var] !== p.expect.equals) {
    s.violations.push(`Wrong result: ${p.expect.var} should be ${p.expect.equals}, got ${s.vars[p.expect.var]}.`);
  }
  if (live.length && live.every((t) => s.status[t] === 'blocked')) {
    s.violations.push(`Deadlock: ${live.join(', ')} are all blocked.`);
  }
  return { state: s, explain: { summary, why } };
}

export function runSync(p: SyncParams): SyncTrace {
  const problems = validateSync(p);
  if (problems.length) throw new Error(problems.join('\n'));
  let s = initialState(p);
  const steps: Step<SyncState>[] = [{ index: 0, state: s, explain: { summary: 'Start.', why: 'All threads are ready at line 0. Pick who runs next, or play the schedule.' } }];
  const ids = p.threads.map((t) => t.id);
  const rng = p.schedule.kind === 'seeded' ? mulberry32(p.schedule.seed) : null;
  let order = p.schedule.kind === 'explicit' ? [...p.schedule.order] : null;
  let current = 0, used = 0; // round robin

  const pickNext = (): string | undefined => {
    const r = runnable(s);
    if (!r.length) return undefined;
    if (order) {
      while (order.length && !r.includes(order[0])) order.shift();
      return order.shift();
    }
    if (rng) return r[Math.floor(rng() * r.length)];
    const slice = p.schedule.kind === 'roundrobin' ? p.schedule.slice : 1;
    if (used >= slice || s.status[ids[current]] !== 'ready') {
      used = 0;
      for (let k = 1; k <= ids.length; k++) {
        const j = (current + k) % ids.length;
        if (s.status[ids[j]] === 'ready') { current = j; break; }
      }
    }
    used++;
    return ids[current];
  };

  for (let n = 0; n < p.maxSteps; n++) {
    const tid = pickNext();
    if (!tid) break;
    const r = exec(p, s, tid);
    s = r.state;
    steps.push({ index: steps.length, state: s, explain: r.explain });
  }
  const live = ids.filter((t) => s.status[t] !== 'done');
  return {
    steps,
    metrics: { finished: live.length === 0, deadlocked: live.length > 0 && live.every((t) => s.status[t] === 'blocked'), violations: s.violations },
  };
}

/**
 * Breadth-first search over every interleaving, so the first violation found has the shortest schedule.
 * States already seen are pruned, which keeps textbook-sized programs instant.
 * ponytail: exponential in threads × steps; fine for ≤ 4 small threads, needs partial-order reduction beyond that.
 */
export function findViolation(p: SyncParams, maxDepth: number): string[] | null {
  const problems = validateSync(p);
  if (problems.length) throw new Error(problems.join('\n'));
  const key = (s: SyncState) => JSON.stringify({ ...s, ran: null });
  let frontier: { s: SyncState; order: string[] }[] = [{ s: initialState(p), order: [] }];
  const seen = new Set([key(frontier[0].s)]);
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const { s, order } of frontier) {
      for (const tid of runnable(s)) {
        const r = exec(p, s, tid);
        const o = [...order, tid];
        if (r.state.violations.length) return o;
        const k = key(r.state);
        if (!seen.has(k)) { seen.add(k); next.push({ s: r.state, order: o }); }
      }
    }
    frontier = next;
  }
  return null;
}
