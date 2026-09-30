import { useId, useMemo, useState, type PointerEvent as RPointerEvent } from 'react';
import { algoLabel, compareSchedulers, schedulerPresets as P, type Algo, type Proc, type SchedulerState, type SchedulerTrace } from '../engine';
import { useSim, type SchedulerUi } from '../store';
import { ExplainPanel, Layout, MAX_SERIES, NumberField, NumbersField, Panel, Segmented, Stat, Toggle, fmt, pct, series, useStep, useWidth } from './common';
import { Icon } from './icons';
import { Playback } from './Playback';

const KINDS: { value: Algo['kind']; label: string; title: string }[] = [
  { value: 'fcfs', label: 'FCFS', title: 'First-come, first-served' },
  { value: 'sjf', label: 'SJF', title: 'Shortest job first' },
  { value: 'srtf', label: 'SRTF', title: 'Shortest remaining time first' },
  { value: 'rr', label: 'RR', title: 'Round robin' },
  { value: 'priority', label: 'PRIO', title: 'Priority' },
  { value: 'mlfq', label: 'MLFQ', title: 'Multi-level feedback queue' },
];

const DEFAULT_ALGO: Record<Algo['kind'], Algo> = {
  fcfs: { kind: 'fcfs' },
  sjf: { kind: 'sjf' },
  srtf: { kind: 'srtf' },
  rr: { kind: 'rr', quantum: 2 },
  priority: { kind: 'priority', preemptive: true },
  mlfq: { kind: 'mlfq', quanta: [2, 4, 8], boostEvery: 20 },
};

const ABOUT: Record<Algo['kind'], string> = {
  fcfs: 'Runs processes in arrival order, each to the end of its burst. Simple, fair in order, terrible when a long job arrives first.',
  sjf: 'Picks the shortest next CPU burst whenever the CPU frees up. Provably minimal average waiting time, but needs to know the future.',
  srtf: 'SJF with preemption: a new arrival with less remaining time takes the CPU immediately.',
  rr: 'Each process gets a fixed time slice, then goes to the back of the queue. Good response time; the quantum is the whole game.',
  priority: 'Lowest number wins. Without aging, low-priority work can starve forever; aging slowly raises whoever waits.',
  mlfq: 'Learns from behaviour: jobs that burn a full slice sink to lower, longer-slice queues; short and interactive jobs stay on top.',
};

const PRESETS: { id: string; name: string; procs: Proc[]; algo?: Algo }[] = [
  { id: 'mixed', name: 'Mixed CPU + I/O workload', procs: P.MIXED },
  { id: 'convoy', name: 'Convoy effect · Silberschatz §5.3.1', procs: P.CONVOY, algo: { kind: 'fcfs' } },
  { id: 'sjf', name: 'SJF example · Silberschatz §5.3.2', procs: P.SJF_BOOK, algo: { kind: 'sjf' } },
  { id: 'srtf', name: 'SRTF example · Silberschatz §5.3.2', procs: P.SRTF_BOOK, algo: { kind: 'srtf' } },
  { id: 'prio', name: 'Priority example · Silberschatz §5.3.3', procs: P.PRIORITY_BOOK, algo: { kind: 'priority', preemptive: false } },
  { id: 'rr', name: 'Round robin q=4 · Silberschatz §5.3.4', procs: P.CONVOY, algo: { kind: 'rr', quantum: 4 } },
  { id: 'mlfq', name: 'MLFQ · OSTEP ch. 8, Fig. 8.3', procs: P.MLFQ_OSTEP, algo: { kind: 'mlfq', quanta: [10, 10, 10] } },
];

function useRun(sc: SchedulerUi) {
  return useMemo(() => {
    const algos = [sc.algo, ...sc.compare];
    try {
      return { traces: compareSchedulers(sc.procs, algos, sc.contextSwitchCost), algos, error: undefined };
    } catch (e) {
      return { traces: undefined, algos, error: (e as Error).message.split('\n') };
    }
  }, [sc]);
}

export function SchedulerView() {
  const sc = useSim((s) => s.scheduler);
  const run = useRun(sc);
  const traces = run.traces;
  const total = traces ? Math.max(...traces.map((t) => t.steps.length)) : 1;
  const i = useStep(total);
  const primary = traces?.[0];
  const stateOf = (tr: SchedulerTrace) => tr.steps[Math.min(i, tr.steps.length - 1)].state;
  const label = (k: number) => (primary ? `t = ${primary.steps[Math.min(k, primary.steps.length - 1)].state.t}` : '—');
  const compare = sc.compare.length > 0;

  const controls = (
    <>
      <WorkloadPanel sc={sc} />
      <AlgorithmPanel sc={sc} />
      <ComparePanel sc={sc} />
    </>
  );

  const stage = !traces || !primary ? null : (
    <>
      <Panel
        label={compare ? 'Timelines · shared clock' : 'Timeline'} index="02" id="timeline"
        actions={<Legend />}
      >
        <Timeline traces={traces} algos={run.algos} procs={sc.procs} i={i} compare={compare} />
      </Panel>
      {compare && (
        <Panel label="Head to head" index="03" id="compare">
          <CompareTable traces={traces} algos={run.algos} />
        </Panel>
      )}
      <div className="split">
        <Panel label={`Queues · ${algoLabel(sc.algo)}`} index={compare ? '04' : '03'} id="queues">
          <Queues state={stateOf(primary)} procs={sc.procs} algo={sc.algo} />
        </Panel>
        <Panel label="Metrics" index={compare ? '05' : '04'} id="metrics">
          <Metrics trace={primary} state={stateOf(primary)} procs={sc.procs} />
        </Panel>
      </div>
    </>
  );

  const extra = compare && traces ? (
    <ul className="explain-compare">
      {traces.slice(1).map((tr, k) => (
        <li key={k}>
          <span className="mono">{algoLabel(run.algos[k + 1])}</span>
          {tr.steps[Math.min(i, tr.steps.length - 1)].explain.summary}
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <Layout
      controls={controls}
      stage={stage}
      explain={<ExplainPanel steps={primary?.steps ?? []} i={i} label={label} extra={extra} error={run.error} />}
      playback={<Playback total={total} label={label} marks={primary?.metrics.gantt.filter((g) => g.who !== 'idle').map((g) => g.from)} />}
    />
  );
}

// ---------------------------------------------------------------- controls

function WorkloadPanel({ sc }: { sc: SchedulerUi }) {
  const update = useSim((s) => s.update);
  const setProcs = (procs: Proc[]) => update('scheduler', { procs });
  const add = () => {
    const used = new Set(sc.procs.map((p) => p.id));
    let n = sc.procs.length + 1;
    while (used.has(`P${n}`)) n++;
    const lastArrival = sc.procs.at(-1)?.arrival ?? 0;
    setProcs([...sc.procs, { id: `P${n}`, arrival: lastArrival + 1, bursts: [4], priority: 2 }]);
  };
  return (
    <Panel label="Workload" index="01" id="workload">
      <label className="field">
        <span>Preset</span>
        <select
          value=""
          onChange={(e) => {
            const p = PRESETS.find((x) => x.id === e.target.value);
            if (p) update('scheduler', { procs: p.procs, ...(p.algo && { algo: p.algo }) });
            useSim.getState().setCursor(0);
          }}
        >
          <option value="" disabled>Load a textbook example…</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="table-wrap">
        <table className="proc-table">
          <thead>
            <tr><th aria-label="Colour" /><th>Name</th><th title="Arrival time">Arr</th><th title="CPU, I/O, CPU… burst lengths">Bursts</th><th title="Priority (lower = more important)">Pri</th><th aria-label="Remove" /></tr>
          </thead>
          <tbody>
            {sc.procs.map((p, i) => (
              <tr key={i}>
                <td><span className="swatch" style={{ background: series(i) }} /></td>
                <td><input className="cell" value={p.id} maxLength={6} aria-label={`Process ${i + 1} name`} onChange={(e) => setProcs(sc.procs.map((q, k) => (k === i ? { ...q, id: e.target.value } : q)))} /></td>
                <td><NumberField compact label={`${p.id} arrival`} value={p.arrival} max={500} onChange={(arrival) => setProcs(sc.procs.map((q, k) => (k === i ? { ...q, arrival } : q)))} /></td>
                <td><NumbersField compact label={`${p.id} bursts`} value={p.bursts} onChange={(bursts) => setProcs(sc.procs.map((q, k) => (k === i ? { ...q, bursts } : q)))} /></td>
                <td><NumberField compact label={`${p.id} priority`} value={p.priority} max={99} onChange={(priority) => setProcs(sc.procs.map((q, k) => (k === i ? { ...q, priority } : q)))} /></td>
                <td>
                  <button type="button" className="icon-btn small" aria-label={`Remove ${p.id}`} disabled={sc.procs.length <= 1} onClick={() => setProcs(sc.procs.filter((_, k) => k !== i))}>
                    <Icon name="x" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-between">
        <button type="button" className="btn ghost small" onClick={add} disabled={sc.procs.length >= MAX_SERIES}><Icon name="plus" size={14} />Process</button>
        <span className="hint">Bursts alternate CPU · I/O · CPU</span>
      </div>
      <NumberField label="Context-switch cost (ticks)" value={sc.contextSwitchCost ?? 0} max={10} onChange={(contextSwitchCost) => update('scheduler', { contextSwitchCost })} />
    </Panel>
  );
}

function AlgorithmPanel({ sc }: { sc: SchedulerUi }) {
  const update = useSim((s) => s.update);
  const a = sc.algo;
  const set = (algo: Algo) => update('scheduler', { algo, compare: sc.compare.filter((c) => c.kind !== algo.kind) });
  return (
    <Panel label="Algorithm" index="◆" id="algorithm">
      <Segmented label="Scheduling algorithm" value={a.kind} options={KINDS} onChange={(k) => k !== a.kind && set(DEFAULT_ALGO[k])} />
      <p className="about">{ABOUT[a.kind]}</p>
      {a.kind === 'rr' && <NumberField label="Quantum" value={a.quantum} min={1} max={50} onChange={(quantum) => set({ ...a, quantum })} />}
      {a.kind === 'priority' && (
        <>
          <Toggle label="Preemptive" checked={a.preemptive} onChange={(preemptive) => set({ ...a, preemptive })} />
          <Toggle label="Aging" checked={!!a.aging} onChange={(on) => set({ ...a, aging: on ? { every: 3, boost: 1 } : undefined })} />
          {a.aging && (
            <div className="field-row">
              <NumberField label="Every (ticks)" value={a.aging.every} min={1} max={100} onChange={(every) => set({ ...a, aging: { ...a.aging!, every } })} />
              <NumberField label="Boost" value={a.aging.boost} min={1} max={10} onChange={(boost) => set({ ...a, aging: { ...a.aging!, boost } })} />
            </div>
          )}
        </>
      )}
      {a.kind === 'mlfq' && (
        <div className="field-row">
          <NumbersField label="Quanta per level" value={a.quanta} onChange={(quanta) => set({ ...a, quanta })} />
          <NumberField label="Boost every (0 = off)" value={a.boostEvery ?? 0} max={1000} onChange={(n) => set({ ...a, boostEvery: n || undefined })} />
        </div>
      )}
    </Panel>
  );
}

function ComparePanel({ sc }: { sc: SchedulerUi }) {
  const update = useSim((s) => s.update);
  const on = (k: Algo['kind']) => sc.compare.some((c) => c.kind === k);
  const toggle = (k: Algo['kind']) =>
    update('scheduler', { compare: on(k) ? sc.compare.filter((c) => c.kind !== k) : [...sc.compare, DEFAULT_ALGO[k]].slice(-2) });
  return (
    <Panel label="Compare" index="≡" id="comparepanel">
      <p className="about">Run the same workload through up to two more algorithms. All timelines share one clock.</p>
      <div className="chips-select" role="group" aria-label="Algorithms to compare">
        {KINDS.filter((k) => k.value !== sc.algo.kind).map((k) => (
          <button key={k.value} type="button" aria-pressed={on(k.value)} onClick={() => toggle(k.value)} title={k.title}>{k.label}</button>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- timeline

type Kind = 'run' | 'ready' | 'io' | 'idle' | 'switch';
interface Seg { from: number; to: number; kind: Kind; who?: string }
interface Row { label: string; segs: Seg[]; tall: boolean; switches: number[] }

function cpuRow(tr: SchedulerTrace, label: string): Row {
  const switches: number[] = [];
  let last: string | null = null;
  const segs = tr.metrics.gantt.map((g, k) => {
    const kind: Kind = g.who === 'idle' ? 'idle' : g.who === 'switch' ? 'switch' : 'run';
    if (kind === 'run') {
      if (last && last !== g.who) switches.push(tr.metrics.gantt[k - 1]?.who === 'switch' ? tr.metrics.gantt[k - 1].from : g.from);
      last = g.who;
    }
    return { from: g.from, to: g.to, kind, who: g.who };
  });
  return { label, segs, tall: true, switches };
}

function laneRows(tr: SchedulerTrace, procs: Proc[]): Row[] {
  return procs.map((p) => {
    const segs: Seg[] = [];
    for (const { state: s } of tr.steps.slice(0, -1)) {
      const kind: Kind | null = s.running === p.id && !s.switching ? 'run'
        : s.ready.includes(p.id) || s.running === p.id ? 'ready'
        : s.blocked.some((b) => b.id === p.id) ? 'io' : null;
      if (!kind) continue;
      const last = segs.at(-1);
      if (last && last.kind === kind && last.to === s.t) last.to = s.t + 1;
      else segs.push({ from: s.t, to: s.t + 1, kind, who: p.id });
    }
    return { label: p.id, segs, tall: false, switches: [] };
  });
}

function Timeline({ traces, algos, procs, i, compare }: { traces: SchedulerTrace[]; algos: Algo[]; procs: Proc[]; i: number; compare: boolean }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const setCursor = useSim((s) => s.setCursor);
  const setPlaying = useSim((s) => s.setPlaying);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const color = (who?: string) => series(Math.max(0, procs.findIndex((p) => p.id === who)));

  const rows: Row[] = compare
    ? traces.map((tr, k) => cpuRow(tr, algoLabel(algos[k])))
    : [cpuRow(traces[0], 'CPU'), ...laneRows(traces[0], procs)];
  const makespan = Math.max(...traces.map((tr) => tr.metrics.gantt.at(-1)!.to));
  const t = Math.min(i, makespan); // one step per tick, so step index == tick

  const padL = compare ? Math.max(...rows.map((r) => r.label.length)) * 7 + 18 : 44;
  const padR = 14;
  const avail = (width || 640) - padL - padR;
  const unit = Math.max(9, avail / makespan);
  const W = padL + padR + unit * makespan;
  const x = (tt: number) => padL + tt * unit;
  const TALL = compare ? 26 : 30, LANE = 12, GAP = compare ? 12 : 9;
  let yy = 22;
  const ys = rows.map((r) => { const y = yy; yy += (r.tall ? TALL : LANE) + GAP + (r.tall && !compare ? 8 : 0); return y; });
  const axisY = yy + 2;
  const H = axisY + 22;
  const tickStep = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((s) => s * unit >= 26) ?? 1000;
  const ticks = Array.from({ length: Math.floor(makespan / tickStep) + 1 }, (_, k) => k * tickStep);

  const toT = (e: RPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(makespan, Math.floor((e.clientX - r.left - padL) / unit)));
  };
  const hoverTick = hover ?? t;
  const st = traces[0].steps[Math.min(hoverTick, traces[0].steps.length - 1)].state;
  const readout = compare
    ? `t = ${hoverTick}`
    : `t = ${hoverTick} · CPU ${st.running ? (st.switching ? `switching → ${st.running}` : st.running) : 'idle'} · ready [${st.ready.join(' ')}]${st.blocked.length ? ` · I/O [${st.blocked.map((b) => b.id).join(' ')}]` : ''}`;

  return (
    <div className="timeline">
      <div className="readout mono" aria-hidden>{hover !== null ? readout : `${readout}`}</div>
      <div className="timeline-scroll" ref={wrap}>
        <svg
          data-export width={Math.max(W, width || 0)} height={H} role="img"
          aria-label={`Gantt chart, ${makespan} ticks. Current time ${t}. See the metrics table for exact values.`}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setPlaying(false); setCursor(toT(e)); }}
          onPointerMove={(e) => { if (e.buttons & 1) setCursor(toT(e)); setHover(toT(e)); }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <pattern id={`h${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="5" className="hatch-line" strokeWidth="1.4" />
            </pattern>
          </defs>
          {ticks.map((tk) => <line key={tk} x1={x(tk)} x2={x(tk)} y1={14} y2={axisY} className="grid-line" />)}
          {rows.map((r, k) => {
            const y = ys[k];
            const h = r.tall ? TALL : LANE;
            return (
              <g key={r.label + k}>
                <text x={padL - 10} y={y + h / 2} className={`row-label ${r.tall ? 'strong' : ''}`} textAnchor="end" dominantBaseline="central">{r.label}</text>
                <rect x={x(0)} y={y} width={unit * makespan} height={h} className="row-bg" rx={3} />
                {r.segs.map((s, n) => {
                  const to = Math.min(s.to, t + 1);
                  if (to <= s.from) return null;
                  const now = to === t + 1 && t < makespan;
                  const sx = x(s.from) + 1, sw = Math.max(1, (to - s.from) * unit - 2);
                  const c = color(s.who);
                  if (s.kind === 'ready') return <rect key={n} x={sx} y={y + h / 2 - 1} width={sw} height={2} fill={c} className="seg-ready" />;
                  if (s.kind === 'io') return <rect key={n} x={sx} y={y + 1} width={sw} height={h - 2} rx={2} fill={`url(#h${uid})`} stroke={c} className="seg-io" />;
                  if (s.kind === 'idle') return <rect key={n} x={sx} y={y + 3} width={sw} height={h - 6} rx={2} fill={`url(#h${uid})`} className="seg-idle" />;
                  if (s.kind === 'switch') return <rect key={n} x={sx} y={y + 3} width={sw} height={h - 6} rx={2} className="seg-switch" />;
                  return (
                    <g key={n} className={now ? 'seg-now' : undefined}>
                      <rect x={sx} y={y} width={sw} height={h} rx={3} fill={c} className="seg-run" />
                      {r.tall && sw > 20 && <text x={sx + sw / 2} y={y + h / 2} className="seg-label" textAnchor="middle" dominantBaseline="central">{s.who}</text>}
                      <title>{`${s.who}: t ${s.from}–${s.to}`}</title>
                    </g>
                  );
                })}
                {r.switches.filter((sx) => sx <= t).map((sx) => (
                  <path key={sx} d={`M${x(sx) - 4},${y - 7} h8 l-4,5 z`} className="switch-mark"><title>{`Context switch at t=${sx}`}</title></path>
                ))}
              </g>
            );
          })}
          <line x1={x(0)} x2={x(makespan)} y1={axisY} y2={axisY} className="axis-line" />
          {ticks.map((tk) => <text key={tk} x={x(tk)} y={axisY + 13} className="tick-label" textAnchor="middle">{tk}</text>)}
          {hover !== null && hover !== t && <line x1={x(hover) + unit / 2} x2={x(hover) + unit / 2} y1={14} y2={axisY} className="hover-line" />}
          <g className="cursor" transform={`translate(${x(t)},0)`}>
            <line y1={12} y2={axisY} />
            <rect x={-15} y={0} width={30} height={13} rx={3} />
            <text y={7} textAnchor="middle" dominantBaseline="central">{t}</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      <span><i className="lg-run" />running</span>
      <span><i className="lg-ready" />ready</span>
      <span><i className="lg-io" />I/O</span>
      <span><i className="lg-switch" />switch</span>
    </div>
  );
}

// ---------------------------------------------------------------- queues & metrics

function Chip({ id, procs, sub, big }: { id: string; procs: Proc[]; sub?: string; big?: boolean }) {
  return (
    <span className={`chip ${big ? 'big' : ''}`} style={{ '--c': series(procs.findIndex((p) => p.id === id)) } as React.CSSProperties}>
      <i aria-hidden />{id}{sub && <small>{sub}</small>}
    </span>
  );
}

function Queues({ state: s, procs, algo }: { state: SchedulerState; procs: Proc[]; algo: Algo }) {
  const sub = (id: string) => `${s.remaining[id] ?? ''}${s.effPriority ? ` · p${s.effPriority[id]}` : ''}`;
  const levels = algo.kind === 'mlfq' ? algo.quanta.map((q, l) => ({ l, q, ids: s.ready.filter((id) => s.level?.[id] === l) })) : null;
  return (
    <div className="queues">
      <div className="cpu-core" data-state={s.running ? (s.switching ? 'switch' : 'busy') : 'idle'}>
        <span className="q-label">CPU</span>
        {s.running ? <Chip key={`cpu-${s.running}`} id={s.running} procs={procs} sub={s.switching ? 'loading' : `${s.remaining[s.running]} left`} big /> : <span className="q-empty">idle</span>}
      </div>
      {levels ? (
        levels.map(({ l, q, ids }) => (
          <div className="q-row" key={l}>
            <span className="q-label">Q{l}<small>q={q}</small></span>
            <div className="q-chips">{ids.length ? ids.map((id) => <Chip key={`q${l}-${id}`} id={id} procs={procs} sub={sub(id)} />) : <span className="q-empty">—</span>}</div>
          </div>
        ))
      ) : (
        <div className="q-row">
          <span className="q-label">Ready</span>
          <div className="q-chips">{s.ready.length ? s.ready.map((id) => <Chip key={`r-${id}`} id={id} procs={procs} sub={sub(id)} />) : <span className="q-empty">empty</span>}</div>
        </div>
      )}
      <div className="q-row">
        <span className="q-label">I/O</span>
        <div className="q-chips">{s.blocked.length ? s.blocked.map((b) => <Chip key={`io-${b.id}`} id={b.id} procs={procs} sub={`→ t${b.until}`} />) : <span className="q-empty">—</span>}</div>
      </div>
      <div className="q-row">
        <span className="q-label">Done</span>
        <div className="q-chips">{s.done.length ? s.done.map((id) => <Chip key={`d-${id}`} id={id} procs={procs} />) : <span className="q-empty">—</span>}</div>
      </div>
    </div>
  );
}

function Metrics({ trace, state, procs }: { trace: SchedulerTrace; state: SchedulerState; procs: Proc[] }) {
  const m = trace.metrics;
  const final = state.done.length === procs.length;
  return (
    <>
      <div className="stats">
        <Stat label="Avg waiting" value={fmt(m.avgWaiting)} />
        <Stat label="Avg turnaround" value={fmt(m.avgTurnaround)} />
        <Stat label="Avg response" value={fmt(m.avgResponse)} />
        <Stat label="CPU utilization" value={pct(m.cpuUtilization)} />
        <Stat label="Throughput" value={fmt(m.throughput * 10)} sub="per 10 ticks" />
        <Stat label="Context switches" value={m.contextSwitches} />
      </div>
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">Per-process results</caption>
          <thead><tr><th>Proc</th><th>Arr</th><th>Done</th><th>Turn</th><th>Wait</th><th>Resp</th></tr></thead>
          <tbody>
            {procs.map((p, k) => {
              const r = m.perProc[p.id];
              return (
                <tr key={p.id} className={state.done.includes(p.id) ? '' : 'pending'}>
                  <td><span className="swatch" style={{ background: series(k) }} />{p.id}</td>
                  <td>{p.arrival}</td><td>{r.completion}</td><td>{r.turnaround}</td><td>{r.waiting}</td><td>{r.response}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">{final ? 'All processes complete.' : 'Final values; rows brighten as each process completes.'}</p>
    </>
  );
}

const COMPARE_ROWS: { label: string; get: (t: SchedulerTrace) => number; better: 'low' | 'high'; show: (n: number) => string }[] = [
  { label: 'Avg waiting', get: (t) => t.metrics.avgWaiting, better: 'low', show: (n) => fmt(n) },
  { label: 'Avg turnaround', get: (t) => t.metrics.avgTurnaround, better: 'low', show: (n) => fmt(n) },
  { label: 'Avg response', get: (t) => t.metrics.avgResponse, better: 'low', show: (n) => fmt(n) },
  { label: 'CPU utilization', get: (t) => t.metrics.cpuUtilization, better: 'high', show: pct },
  { label: 'Context switches', get: (t) => t.metrics.contextSwitches, better: 'low', show: String },
  { label: 'Makespan', get: (t) => t.metrics.gantt.at(-1)!.to, better: 'low', show: String },
];

function CompareTable({ traces, algos }: { traces: SchedulerTrace[]; algos: Algo[] }) {
  return (
    <div className="table-wrap">
      <table className="data compare">
        <thead><tr><th>Metric</th>{algos.map((a, k) => <th key={k}>{algoLabel(a)}</th>)}</tr></thead>
        <tbody>
          {COMPARE_ROWS.map((r) => {
            const vals = traces.map(r.get);
            const best = r.better === 'low' ? Math.min(...vals) : Math.max(...vals);
            const max = Math.max(...vals) || 1;
            return (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {vals.map((v, k) => (
                  <td key={k} className={v === best ? 'best' : ''}>
                    <span className="bar" style={{ '--w': v / max } as React.CSSProperties} aria-hidden />
                    <span className="val">{r.show(v)}</span>
                    {v === best && <span className="sr-only"> (best)</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
