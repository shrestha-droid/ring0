import { create } from 'zustand';
import {
  BANKER_BOOK, RACY_COUNTER, RAG_DEADLOCK, SILBERSCHATZ_REFS, checkSafety, decodeScenario, detectDeadlock, encodeScenario,
  runPaging, runScheduler, runSync, schedulerPresets,
  type Algo, type BankerState, type DeadlockParams, type ModuleId, type PagingParams, type Rag, type ScenarioEnvelope,
  type SchedulerParams, type SyncParams,
} from './engine';

export type SchedulerUi = SchedulerParams & { compare: Algo[] };
export type MemoryUi = PagingParams & { seed: number };
export interface DeadlockUi {
  kind: 'rag' | 'banker';
  rag: Rag;
  banker: BankerState;
  names: string[];
  request: { pid: number; req: number[] } | null;
}

interface Scenarios {
  scheduler: SchedulerUi;
  memory: MemoryUi;
  deadlock: DeadlockUi;
  sync: SyncParams;
}

interface Sim extends Scenarios {
  module: ModuleId;
  cursor: number;
  playing: boolean;
  speed: number;
  toast: string | null;
  switched: boolean; // true after the first module change; drives the enter animation
  setModule: (m: ModuleId) => void;
  update: <K extends keyof Scenarios>(k: K, patch: Partial<Scenarios[K]>) => void;
  setCursor: (n: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  notify: (msg: string) => void;
  load: (env: ScenarioEnvelope<ModuleId, unknown>, cursor?: number) => boolean;
}

/** Circle layout, interleaving processes and resources so dining philosophers sit between their forks. */
export function circleLayout(rag: Rag): Rag {
  const ids: string[] = [];
  for (let i = 0; i < Math.max(rag.processes.length, rag.resources.length); i++) {
    if (rag.processes[i]) ids.push(rag.processes[i]);
    if (rag.resources[i]) ids.push(rag.resources[i].id);
  }
  const layout = Object.fromEntries(ids.map((id, i) => {
    const a = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
    return [id, { x: Math.round(300 + 170 * Math.cos(a)), y: Math.round(215 + 165 * Math.sin(a)) }];
  }));
  return { ...rag, layout };
}

export const DEFAULTS: Scenarios = {
  scheduler: { procs: schedulerPresets.MIXED, algo: { kind: 'rr', quantum: 2 }, contextSwitchCost: 0, compare: [] },
  memory: { refs: SILBERSCHATZ_REFS, frames: 3, algo: 'lru', seed: 1 },
  deadlock: { kind: 'rag', rag: circleLayout(RAG_DEADLOCK), banker: BANKER_BOOK, names: ['P0', 'P1', 'P2', 'P3', 'P4'], request: null },
  sync: RACY_COUNTER,
};

// ---------------------------------------------------------------- envelopes (share links, JSON export)

export function toEnvelope(s: Scenarios, module: ModuleId): ScenarioEnvelope<ModuleId, unknown> {
  const d = s.deadlock;
  const params =
    module === 'deadlock'
      ? (d.kind === 'rag' ? { kind: 'rag', rag: d.rag } : { kind: 'banker', state: d.banker, processNames: d.names, request: d.request })
      : s[module];
  return { v: 1, module, params };
}

/**
 * Turn untrusted envelope params into a scenario, or null. The engine is the validator: if it can't run the
 * scenario, the link is rejected instead of crashing the page.
 */
function accept(env: ScenarioEnvelope<ModuleId, unknown>): Partial<Scenarios> | null {
  const p = env.params as Record<string, unknown>;
  try {
    switch (env.module) {
      case 'scheduler': {
        const sc = { ...DEFAULTS.scheduler, ...(p as Partial<SchedulerUi>) };
        if (!Array.isArray(sc.compare)) return null;
        [sc.algo, ...sc.compare].forEach((algo) => runScheduler({ procs: sc.procs, algo, contextSwitchCost: sc.contextSwitchCost }));
        return { scheduler: sc };
      }
      case 'memory': {
        const m = { ...DEFAULTS.memory, ...(p as Partial<MemoryUi>) };
        runPaging(m);
        return { memory: m };
      }
      case 'deadlock': {
        const d = p as DeadlockParams & { request?: DeadlockUi['request'] };
        if (d.kind === 'rag') {
          detectDeadlock(d.rag);
          return { deadlock: { ...DEFAULTS.deadlock, kind: 'rag', rag: d.rag.layout ? d.rag : circleLayout(d.rag) } };
        }
        if (d.kind === 'banker') {
          checkSafety(d.state);
          const names = Array.isArray(d.processNames) && d.processNames.length === d.state.max.length ? d.processNames : d.state.max.map((_, i) => `P${i}`);
          return { deadlock: { ...DEFAULTS.deadlock, kind: 'banker', banker: d.state, names, request: d.request ?? null } };
        }
        return null;
      }
      case 'sync':
        runSync(p as unknown as SyncParams);
        return { sync: p as unknown as SyncParams };
    }
  } catch {
    return null;
  }
}

export const useSim = create<Sim>()((set, get) => ({
  ...DEFAULTS,
  module: 'scheduler',
  cursor: 0,
  playing: false,
  speed: 1,
  toast: null,
  switched: false,
  setModule: (module) => set({ module, cursor: 0, playing: false, switched: true }),
  update: (k, patch) => set((s) => ({ [k]: { ...s[k], ...patch }, playing: false }) as Partial<Sim>),
  setCursor: (cursor) => set({ cursor: Math.max(0, cursor) }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  notify: (toast) => {
    set({ toast });
    setTimeout(() => get().toast === toast && set({ toast: null }), 2600);
  },
  load: (env, cursor = 0) => {
    const scenario = accept(env);
    if (!scenario) return false;
    set({ ...scenario, module: env.module, cursor, playing: false });
    return true;
  },
}));

// ---------------------------------------------------------------- URL sync

export function shareUrl(): string {
  const s = useSim.getState();
  return `${location.origin}${location.pathname}#s=${encodeScenario(toEnvelope(s, s.module))}&t=${s.cursor}`;
}

export function initFromUrl() {
  const q = new URLSearchParams(location.hash.slice(1));
  const s = q.get('s');
  if (!s) return;
  const env = decodeScenario(s);
  const ok = env && useSim.getState().load(env, Math.max(0, Number(q.get('t')) || 0));
  if (!ok) useSim.getState().notify("That link's scenario couldn't be loaded, so the default is shown.");
}

/** Keep the address bar pointing at the current scenario. Debounced: Safari throttles frequent replaceState calls. */
export function syncUrl() {
  let timer: ReturnType<typeof setTimeout>;
  useSim.subscribe((s, prev) => {
    if (s.module === prev.module && s[s.module] === prev[s.module]) return;
    clearTimeout(timer);
    timer = setTimeout(() => history.replaceState(null, '', `#s=${encodeScenario(toEnvelope(s, s.module))}`), 300);
  });
}
