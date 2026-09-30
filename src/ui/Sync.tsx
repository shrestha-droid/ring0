import { useMemo, useState } from 'react';
import {
  COUNT_BOOK, LOCKED_COUNTER, OPPOSITE_ORDER, PRODUCER_CONSUMER, PRODUCER_CONSUMER_BROKEN, RACY_COUNTER, READERS_WRITERS,
  findViolation, formatInstr, runSync, type Schedule, type SyncParams, type SyncState, type SyncTrace,
} from '../engine';
import { useSim } from '../store';
import { ExplainPanel, Layout, NumberField, Panel, Segmented, Toggle, series, useStep, useWidth } from './common';
import { Icon } from './icons';
import { Playback } from './Playback';

const withMutex = (p: SyncParams): SyncParams => ({
  ...p,
  threads: p.threads.map((t) => ({ ...t, code: [{ op: 'wait', sem: 'mutex' }, ...t.code, { op: 'signal', sem: 'mutex' }] })),
  sems: { ...p.sems, mutex: 1 },
});

const PROGRAMS: { id: string; name: string; broken: SyncParams; fixed: SyncParams; fixLabel: string }[] = [
  { id: 'race', name: 'Race: counter++', broken: RACY_COUNTER, fixed: LOCKED_COUNTER, fixLabel: 'Guard with a mutex' },
  { id: 'book', name: 'count++ / count-- · Silberschatz §6.1', broken: COUNT_BOOK, fixed: withMutex(COUNT_BOOK), fixLabel: 'Guard with a mutex' },
  { id: 'buffer', name: 'Bounded buffer · §7.1.1', broken: PRODUCER_CONSUMER_BROKEN, fixed: PRODUCER_CONSUMER, fixLabel: 'empty / full / mutex semaphores' },
  { id: 'rw', name: 'Readers–writers · §7.1.2', broken: { ...READERS_WRITERS, sems: { ...READERS_WRITERS.sems, rw_mutex: 2 } }, fixed: READERS_WRITERS, fixLabel: 'rw_mutex admits one writer' },
  {
    id: 'order', name: 'Lock ordering · §6.8.3', broken: OPPOSITE_ORDER, fixLabel: 'Same lock order in both threads',
    fixed: { ...OPPOSITE_ORDER, threads: OPPOSITE_ORDER.threads.map((t) => ({ ...t, code: OPPOSITE_ORDER.threads[0].code })) },
  },
];

const sameProgram = (a: SyncParams, b: SyncParams) => JSON.stringify([a.threads, a.vars, a.sems, a.bufs]) === JSON.stringify([b.threads, b.vars, b.sems, b.bufs]);

function matchProgram(p: SyncParams) {
  for (const prog of PROGRAMS) {
    if (sameProgram(p, prog.fixed)) return { id: prog.id, fixed: true };
    if (sameProgram(p, prog.broken)) return { id: prog.id, fixed: false };
  }
  return { id: 'custom', fixed: false };
}

export function SyncView() {
  const p = useSim((s) => s.sync);
  const run = useMemo(() => {
    try {
      return { trace: runSync(p), error: undefined };
    } catch (e) {
      return { trace: undefined, error: (e as Error).message.split('\n') };
    }
  }, [p]);
  const trace = run.trace;
  const total = trace?.steps.length ?? 1;
  const i = useStep(total);
  const state = trace?.steps[i].state;
  const label = (k: number) => {
    const s = trace?.steps[Math.min(k, total - 1)].state;
    return !s ? '—' : s.ran ? `step ${k} · ${s.ran}` : 'start';
  };
  const marks = trace?.steps.filter((s, k) => k > 0 && s.state.violations.length > trace.steps[k - 1].state.violations.length).map((s) => s.index);

  return (
    <Layout
      controls={<Controls p={p} trace={trace} i={i} />}
      stage={trace && state && (
        <>
          {state.violations.length > 0 && (
            <div className="verdict dead" role="alert">
              <span className="verdict-dot" aria-hidden />
              <strong>{state.violations.length > 1 ? `${state.violations.length} VIOLATIONS` : 'VIOLATION'}</strong>
              <span>{state.violations.at(-1)}</span>
            </div>
          )}
          <Panel label="Threads" index="02" id="threads">
            <Lanes p={p} state={state} />
          </Panel>
          <Panel label="Interleaving" index="03" id="interleaving">
            <Strip p={p} trace={trace} i={i} />
          </Panel>
          <Panel label="Shared memory" index="04" id="shared">
            <Shared p={p} state={state} />
          </Panel>
        </>
      )}
      explain={<ExplainPanel steps={trace?.steps ?? []} i={i} label={label} error={run.error} codeSummary />}
      playback={<Playback total={total} label={label} marks={marks} />}
    />
  );
}

function Controls({ p, trace, i }: { p: SyncParams; trace?: SyncTrace; i: number }) {
  const update = useSim((s) => s.update);
  const notify = useSim((s) => s.notify);
  const [prog, setProg] = useState(() => matchProgram(p));
  const current = PROGRAMS.find((x) => x.id === prog.id);
  const state = trace?.steps[i].state;
  const ranSoFar = trace ? trace.steps.slice(1, i + 1).map((s) => s.state.ran!) : [];

  const load = (id: string, fixed: boolean) => {
    const pr = PROGRAMS.find((x) => x.id === id)!;
    setProg({ id, fixed });
    useSim.getState().update('sync', { ...(fixed ? pr.fixed : pr.broken) });
    useSim.getState().setCursor(0);
  };
  const setSchedule = (schedule: Schedule) => update('sync', { schedule });
  const mode = p.schedule.kind;

  const find = () => {
    const order = findViolation(p, 40);
    if (!order) return notify('No bad interleaving within 40 steps. This program is safe.');
    update('sync', { schedule: { kind: 'explicit', order } });
    useSim.getState().setCursor(0);
    useSim.getState().setPlaying(true);
    notify(`Found one in ${order.length} steps. Playing it.`);
  };

  return (
    <>
      <Panel label="Program" index="01" id="program">
        <label className="field">
          <span>Scenario</span>
          <select value={prog.id} onChange={(e) => load(e.target.value, false)}>
            {prog.id === 'custom' && <option value="custom">Custom (from link)</option>}
            {PROGRAMS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        {current && (
          <div className={`fix ${prog.fixed ? 'on' : ''}`}>
            <Toggle label={prog.fixed ? 'Synchronized' : 'Unsynchronized'} checked={prog.fixed} onChange={(f) => load(prog.id, f)} />
            <span className="hint">{current.fixLabel}</span>
          </div>
        )}
        <button type="button" className="btn accent" onClick={find}><Icon name="search" size={15} />Find a bad interleaving</button>
        <p className="about">Searches every possible interleaving, breadth-first, for the shortest one that corrupts data or deadlocks.</p>
      </Panel>
      <Panel label="Schedule" index="◆" id="schedule">
        <Segmented
          label="Scheduling" value={mode}
          options={[{ value: 'roundrobin', label: 'Round robin' }, { value: 'seeded', label: 'Random' }, { value: 'explicit', label: 'Manual' }]}
          onChange={(k) => {
            if (k === 'roundrobin') setSchedule({ kind: 'roundrobin', slice: 1 });
            if (k === 'seeded') setSchedule({ kind: 'seeded', seed: 1 });
            if (k === 'explicit') { setSchedule({ kind: 'explicit', order: ranSoFar }); notify('Manual: you pick who runs next, starting from here.'); }
          }}
        />
        {p.schedule.kind === 'roundrobin' && <NumberField label="Instructions per turn" value={p.schedule.slice} min={1} max={20} onChange={(slice) => setSchedule({ kind: 'roundrobin', slice })} />}
        {p.schedule.kind === 'seeded' && (
          <div className="field-row">
            <NumberField label="Seed" value={p.schedule.seed} max={99999} onChange={(seed) => setSchedule({ kind: 'seeded', seed })} />
            <button type="button" className="btn ghost small align-end" onClick={() => setSchedule({ kind: 'seeded', seed: ((p.schedule as { seed: number }).seed % 99999) + 1 })}><Icon name="dice" size={14} />Next</button>
          </div>
        )}
        {p.schedule.kind === 'explicit' && state && (
          <>
            <p className="about">Choose which thread executes its next instruction. Stepping back and choosing differently branches the timeline.</p>
            <div className="run-buttons">
              {p.threads.map((t, k) => (
                <button
                  key={t.id} type="button" className="btn run" style={{ '--c': series(k) } as React.CSSProperties}
                  disabled={state.status[t.id] !== 'ready'}
                  onClick={() => { update('sync', { schedule: { kind: 'explicit', order: [...ranSoFar, t.id] } }); useSim.getState().setCursor(i + 1); }}
                >
                  Run {t.id}<small>{state.status[t.id] === 'ready' ? formatInstr(t.code[state.pcs[t.id]]) : state.status[t.id]}</small>
                </button>
              ))}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

function Lanes({ p, state }: { p: SyncParams; state: SyncState }) {
  return (
    <div className="lanes" style={{ '--n': p.threads.length } as React.CSSProperties}>
      {p.threads.map((t, k) => {
        const status = state.status[t.id];
        const pc = state.pcs[t.id];
        const regs = Object.entries(state.regs[t.id]);
        return (
          <div key={t.id} className={`lane ${status} ${state.ran === t.id ? 'ran' : ''}`} style={{ '--c': series(k) } as React.CSSProperties}>
            <div className="lane-head">
              <span className="lane-id"><i aria-hidden />{t.id}</span>
              <span className={`badge ${status === 'blocked' ? 'bad' : status === 'done' ? 'muted' : 'good'}`}>{status}</span>
            </div>
            {regs.length > 0 && <div className="regs">{regs.map(([r, v]) => <span key={r}><small>{r}</small>{v}</span>)}</div>}
            <ol className="code" start={0}>
              {t.code.map((ins, n) => (
                <li key={n} className={n === pc && status !== 'done' ? 'pc' : ''} aria-current={n === pc && status !== 'done' ? 'step' : undefined}>
                  <span className="ln">{n}</span>
                  <code>{formatInstr(ins)}</code>
                </li>
              ))}
            </ol>
            {t.loop && <div className="loop-note">↻ loops</div>}
          </div>
        );
      })}
    </div>
  );
}

function Strip({ p, trace, i }: { p: SyncParams; trace: SyncTrace; i: number }) {
  const setCursor = useSim((s) => s.setCursor);
  const [wrap, width] = useWidth<HTMLDivElement>();
  const ids = p.threads.map((t) => t.id);
  const n = trace.steps.length - 1;
  const RH = 22, padL = 76;
  const C = Math.max(16, Math.min(44, ((width || 600) - padL - 10) / Math.max(n, 1)));
  const W = padL + Math.max(n, 1) * C + 10;
  const H = ids.length * RH + 26;
  return (
    <div className="grid-scroll" ref={wrap}>
      <svg data-export width={W} height={H} role="img" aria-label={`Interleaving of ${n} instructions across ${ids.length} threads`}>
        {ids.map((id, r) => (
          <g key={id}>
            <text x={padL - 10} y={r * RH + RH / 2 + 4} textAnchor="end" dominantBaseline="central" className="row-label">{id}</text>
            <line x1={padL} x2={W - 6} y1={r * RH + RH / 2 + 4} y2={r * RH + RH / 2 + 4} className="grid-line" />
          </g>
        ))}
        {trace.steps.slice(1).map(({ state: s }, k) => {
          const r = ids.indexOf(s.ran!);
          const prev = trace.steps[k].state;
          const bad = s.violations.length > prev.violations.length;
          const future = k + 1 > i;
          return (
            <g key={k} onClick={() => setCursor(k + 1)} className={`strip-cell ${future ? 'future' : ''} ${k + 1 === i ? 'now' : ''}`}>
              <rect x={padL + k * C} y={0} width={C} height={H} fill="transparent" />
              <rect x={padL + k * C + 2} y={r * RH + 6} width={C - 4} height={RH - 4} rx={2} fill={series(r)} className="strip-block" />
              {bad && !future && <path d={`M${padL + k * C + C / 2},${ids.length * RH + 8} l5,9 h-10 z`} className="violation-mark"><title>{s.violations.at(-1)}</title></path>}
            </g>
          );
        })}
        <line x1={padL + i * C} x2={padL + i * C} y1={0} y2={ids.length * RH + 6} className="cursor-line" />
      </svg>
    </div>
  );
}

function Shared({ p, state }: { p: SyncParams; state: SyncState }) {
  const threadIdx = (id: string) => p.threads.findIndex((t) => t.id === id);
  return (
    <div className="shared">
      {Object.keys(state.vars).length > 0 && (
        <div className="shared-group">
          <div className="q-label">Variables</div>
          <div className="cards">
            {Object.entries(state.vars).map(([v, val]) => {
              const stale = p.threads.filter((t) => state.loadedVersions[t.id][v] !== undefined && state.loadedVersions[t.id][v] !== state.versions[v]).map((t) => t.id);
              const expected = p.expect?.var === v ? p.expect.equals : undefined;
              return (
                <div key={v} className={`card ${stale.length ? 'stale' : ''}`}>
                  <div className="card-name">{v}</div>
                  <div className="card-value">{val}</div>
                  <div className="card-sub">
                    v{state.versions[v]}{state.lastWriter[v] && <> · last write {state.lastWriter[v]}</>}
                    {expected !== undefined && <> · expect {expected}</>}
                  </div>
                  {stale.length > 0 && <div className="card-warn">stale copy in {stale.join(', ')}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {Object.keys(state.sems).length > 0 && (
        <div className="shared-group">
          <div className="q-label">Semaphores</div>
          <div className="cards">
            {Object.entries(state.sems).map(([s, val]) => (
              <div key={s} className="card">
                <div className="card-name">{s}</div>
                <div className="card-value">{val}</div>
                <div className="card-sub">
                  {state.waiting[s].length ? (
                    <span className="waiters">waiting: {state.waiting[s].map((t) => <span key={t} className="chip tiny" style={{ '--c': series(threadIdx(t)) } as React.CSSProperties}><i />{t}</span>)}</span>
                  ) : 'no waiters'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {Object.keys(state.bufs).length > 0 && (
        <div className="shared-group">
          <div className="q-label">Buffers</div>
          {Object.entries(state.bufs).map(([b, fill]) => {
            const cap = p.bufs[b];
            const slots = Math.max(cap, fill);
            return (
              <div key={b} className="buffer">
                <span className="card-name">{b}</span>
                <div className="slots" aria-label={`${b}: ${fill} of ${cap} slots full`}>
                  {Array.from({ length: slots }, (_, k) => <span key={k} className={`bslot ${k < fill ? 'full' : ''} ${k >= cap ? 'over' : ''}`} />)}
                  {fill < 0 && <span className="bslot under">−{-fill}</span>}
                </div>
                <span className="mono muted">{fill}/{cap}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
