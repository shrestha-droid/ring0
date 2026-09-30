import { useMemo, useRef, useState } from 'react';
import {
  BANKER_BOOK, RAG_CYCLE_NO_DEADLOCK, RAG_DEADLOCK, checkSafety, detectDeadlock, diningPhilosophers, requestResources,
  type BankerRequestResult, type BankerState, type BankerTrace, type DeadlockResult, type Rag,
} from '../engine';
import { circleLayout, useSim, type DeadlockUi } from '../store';
import { ExplainPanel, Layout, NumberField, NumbersField, Panel, Segmented, useStep } from './common';
import { Icon } from './icons';
import { Playback } from './Playback';

const RAG_PRESETS: { id: string; name: string; make: () => Rag }[] = [
  { id: 'book', name: 'Deadlock · Silberschatz §8.3.2', make: () => RAG_DEADLOCK },
  { id: 'cycle', name: 'Cycle, no deadlock · Silberschatz §8.3.2', make: () => RAG_CYCLE_NO_DEADLOCK },
  { id: 'dining', name: 'Dining philosophers (5)', make: () => diningPhilosophers(5) },
  { id: 'dining-ordered', name: 'Dining philosophers, ordered forks', make: () => diningPhilosophers(5, { ordered: true }) },
];

export function DeadlockView() {
  const d = useSim((s) => s.deadlock);
  return d.kind === 'rag' ? <RagView d={d} /> : <BankerView d={d} />;
}

function KindSwitch({ d }: { d: DeadlockUi }) {
  const update = useSim((s) => s.update);
  return (
    <Segmented
      label="Deadlock tool" value={d.kind}
      options={[{ value: 'rag', label: 'Allocation graph' }, { value: 'banker', label: "Banker's algorithm" }]}
      onChange={(kind) => { update('deadlock', { kind }); useSim.getState().setCursor(0); }}
    />
  );
}

// ---------------------------------------------------------------- resource allocation graph

function RagView({ d }: { d: DeadlockUi }) {
  const [sel, setSel] = useState<string | null>(null);
  const update = useSim((s) => s.update);
  const notify = useSim((s) => s.notify);
  const rag = d.rag;
  const setRag = (r: Rag) => update('deadlock', { rag: r });
  const res = useMemo(() => {
    try {
      return { r: detectDeadlock(rag), error: undefined };
    } catch (e) {
      return { r: undefined, error: (e as Error).message.split('\n') };
    }
  }, [rag]);

  const isP = (id: string) => rag.processes.includes(id);
  const resource = rag.resources.find((r) => r.id === sel);
  const heldOf = (rid: string) => rag.holds.filter((e) => e.from === rid).reduce((a, e) => a + e.count, 0);

  const connect = (a: string, b: string) => {
    if (isP(a) && !isP(b)) {
      const ex = rag.requests.find((e) => e.from === a && e.to === b);
      setRag({ ...rag, requests: ex ? rag.requests.map((e) => (e === ex ? { ...e, count: e.count + 1 } : e)) : [...rag.requests, { from: a, to: b, count: 1 }] });
      notify(`${a} now requests ${b}.`);
    } else if (!isP(a) && isP(b)) {
      const r = rag.resources.find((x) => x.id === a)!;
      if (heldOf(a) >= r.instances) return notify(`${a} has no free instance to assign.`);
      const ex = rag.holds.find((e) => e.from === a && e.to === b);
      setRag({ ...rag, holds: ex ? rag.holds.map((e) => (e === ex ? { ...e, count: e.count + 1 } : e)) : [...rag.holds, { from: a, to: b, count: 1 }] });
      notify(`${a} assigned to ${b}.`);
    }
  };

  const addNode = (kind: 'p' | 'r') => {
    const ids = new Set([...rag.processes, ...rag.resources.map((r) => r.id)]);
    let n = 1;
    const prefix = kind === 'p' ? 'P' : 'R';
    while (ids.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    const count = ids.size;
    const layout = { ...rag.layout, [id]: { x: 90 + ((count * 97) % 420), y: kind === 'p' ? 60 : 370 } };
    setRag(kind === 'p' ? { ...rag, processes: [...rag.processes, id], layout } : { ...rag, resources: [...rag.resources, { id, instances: 1 }], layout });
    setSel(id);
  };

  const remove = (id: string) => {
    const { [id]: _, ...layout } = rag.layout ?? {};
    setRag({
      processes: rag.processes.filter((p) => p !== id),
      resources: rag.resources.filter((r) => r.id !== id),
      requests: rag.requests.filter((e) => e.from !== id && e.to !== id),
      holds: rag.holds.filter((e) => e.from !== id && e.to !== id),
      layout,
    });
    setSel(null);
  };

  const controls = (
    <>
      <Panel label="Tool" index="01" id="tool">
        <KindSwitch d={d} />
        <label className="field">
          <span>Preset</span>
          <select value="" onChange={(e) => { const p = RAG_PRESETS.find((x) => x.id === e.target.value); if (p) { setRag(circleLayout(p.make())); setSel(null); } }}>
            <option value="" disabled>Load a scenario…</option>
            {RAG_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="btn-row">
          <button type="button" className="btn ghost small" onClick={() => addNode('p')}><Icon name="plus" size={14} />Process</button>
          <button type="button" className="btn ghost small" onClick={() => addNode('r')}><Icon name="plus" size={14} />Resource</button>
        </div>
        <p className="about">Drag nodes to arrange. Click a process, then a resource, to add a <b>request</b>. Click a resource, then a process, to <b>assign</b> an instance. Click an edge to remove it.</p>
      </Panel>
      {sel && (
        <Panel label={`Selected · ${sel}`} index="◆" id="inspector">
          {resource && (
            <NumberField label="Instances" value={resource.instances} min={Math.max(1, heldOf(resource.id))} max={6}
              onChange={(instances) => setRag({ ...rag, resources: rag.resources.map((r) => (r.id === resource.id ? { ...r, instances } : r)) })} />
          )}
          <p className="hint">{isP(sel) ? 'Now click a resource to request it.' : 'Now click a process to assign it an instance.'}</p>
          <button type="button" className="btn danger small" onClick={() => remove(sel)}><Icon name="x" size={14} />Delete {sel}</button>
        </Panel>
      )}
    </>
  );

  const r = res.r;
  const stage = (
    <>
      {r && <Verdict r={r} />}
      <Panel label="Resource allocation graph" index="02" id="rag" actions={<RagLegend />}>
        <RagCanvas rag={rag} result={r} sel={sel} onSelect={(id) => {
          if (id === null || id === sel) return setSel(null);
          if (sel && isP(sel) !== isP(id)) { connect(sel, id); setSel(null); } else setSel(id);
        }} onChange={setRag} />
      </Panel>
    </>
  );

  const extra = r && r.finishOrder.length > 0 && (
    <div className="seq">
      <div className="q-label">Reduction order</div>
      <ol className="seq-list">{r.finishOrder.map((p) => <li key={p}>{p}</li>)}</ol>
    </div>
  );
  return <Layout controls={controls} stage={stage} explain={<ExplainPanel steps={r ? [{ explain: r.explain }] : []} i={0} label={() => 'graph reduction'} extra={extra} error={res.error} />} />;
}

function Verdict({ r }: { r: DeadlockResult }) {
  const kind = r.deadlocked.length ? 'dead' : r.cycle ? 'warn' : 'ok';
  return (
    <div className={`verdict ${kind}`} role="status">
      <span className="verdict-dot" aria-hidden />
      <strong>{kind === 'dead' ? 'DEADLOCK' : kind === 'warn' ? 'CYCLE · NO DEADLOCK' : 'NO DEADLOCK'}</strong>
      <span>{r.explain.summary}</span>
    </div>
  );
}

function RagLegend() {
  return (
    <div className="legend">
      <span><i className="lg-request" />request</span>
      <span><i className="lg-assign" />assigned</span>
      <span><i className="lg-dead" />deadlocked</span>
    </div>
  );
}

const PR = 25, RW = 66, RH = 42;

function border(from: { x: number; y: number }, to: { x: number; y: number }, isProc: boolean) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = isProc ? PR / len : Math.min((RW / 2) / Math.abs(dx || 1e-9), (RH / 2) / Math.abs(dy || 1e-9));
  return { x: from.x + dx * Math.min(t, 0.45), y: from.y + dy * Math.min(t, 0.45) };
}

function RagCanvas({ rag, result, sel, onSelect, onChange }: { rag: Rag; result?: DeadlockResult; sel: string | null; onSelect: (id: string | null) => void; onChange: (r: Rag) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const pos = (id: string) => rag.layout?.[id] ?? { x: 300, y: 215 };
  const isP = (id: string) => rag.processes.includes(id);
  const dead = new Set(result?.deadlocked);
  const cyc = result?.cycle ?? [];
  const cycEdges = new Set(cyc.map((a, k) => `${a}>${cyc[(k + 1) % cyc.length]}`));
  const cycleClass = result?.deadlocked.length ? 'cycle' : 'cycle-soft';

  const toSvg = (e: React.PointerEvent) => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: pt.x, y: pt.y };
  };

  const edges = [
    ...rag.requests.map((e) => ({ ...e, kind: 'request' as const })),
    ...rag.holds.map((e) => ({ ...e, kind: 'assign' as const })),
  ];
  const hasReverse = (a: string, b: string) => edges.some((e) => e.from === b && e.to === a);
  const removeEdge = (kind: 'request' | 'assign', from: string, to: string) =>
    onChange(kind === 'request'
      ? { ...rag, requests: rag.requests.filter((e) => !(e.from === from && e.to === to)) }
      : { ...rag, holds: rag.holds.filter((e) => !(e.from === from && e.to === to)) });

  return (
    <div className="rag-wrap">
      <svg
        ref={svg} data-export viewBox="0 0 600 430" className="rag" role="img"
        aria-label={`Resource allocation graph with ${rag.processes.length} processes and ${rag.resources.length} resources. ${result?.explain.summary ?? ''}`}
        onPointerDown={(e) => { if (e.target === svg.current) onSelect(null); }}
        onPointerMove={(e) => {
          const dr = drag.current;
          if (!dr) return;
          const p = toSvg(e);
          const nx = Math.round(Math.max(40, Math.min(560, p.x - dr.dx))), ny = Math.round(Math.max(30, Math.min(400, p.y - dr.dy)));
          const cur = pos(dr.id);
          if (Math.hypot(nx - cur.x, ny - cur.y) > 2) dr.moved = true;
          if (dr.moved) onChange({ ...rag, layout: { ...rag.layout, [dr.id]: { x: nx, y: ny } } });
        }}
        onPointerUp={() => { const dr = drag.current; drag.current = null; if (dr && !dr.moved) onSelect(dr.id); }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrowhead" /></marker>
          <marker id="arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrowhead hot" /></marker>
          <marker id="arrow-warm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="arrowhead warm" /></marker>
        </defs>
        {edges.map((e) => {
          const a = pos(e.from), b = pos(e.to);
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const off = hasReverse(e.from, e.to) ? 7 : 0;
          const nx = (-(b.y - a.y) / len) * off, ny = ((b.x - a.x) / len) * off;
          const s = border({ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, isP(e.from));
          const t = border({ x: b.x + nx, y: b.y + ny }, { x: a.x + nx, y: a.y + ny }, isP(e.to));
          const inCycle = cycEdges.has(`${e.from}>${e.to}`);
          const cls = `edge ${e.kind} ${inCycle ? cycleClass : ''}`;
          return (
            <g key={`${e.kind}${e.from}${e.to}`} className="edge-g" onClick={() => removeEdge(e.kind, e.from, e.to)}>
              <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} className="edge-hit" />
              <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} className={cls} markerEnd={`url(#${inCycle ? (cycleClass === 'cycle' ? 'arrow-hot' : 'arrow-warm') : 'arrow'})`} />
              {e.count > 1 && <text x={(s.x + t.x) / 2 + nx * 2} y={(s.y + t.y) / 2 + ny * 2} className="edge-count" textAnchor="middle" dominantBaseline="central">×{e.count}</text>}
              <title>{`${e.kind === 'request' ? `${e.from} requests ${e.to}` : `${e.from} assigned to ${e.to}`}${e.count > 1 ? ` (${e.count})` : ''}. Click to remove.`}</title>
            </g>
          );
        })}
        {[...rag.processes.map((id) => ({ id, p: true })), ...rag.resources.map((r) => ({ id: r.id, p: false }))].map(({ id, p }) => {
          const { x, y } = pos(id);
          const r = rag.resources.find((q) => q.id === id);
          const held = r ? rag.holds.filter((e) => e.from === id).reduce((a, e) => a + e.count, 0) : 0;
          const cls = `node ${p ? 'proc' : 'res'} ${dead.has(id) ? 'dead' : ''} ${cyc.includes(id) ? cycleClass : ''} ${sel === id ? 'selected' : ''}`;
          return (
            <g
              key={id} className={cls} transform={`translate(${x},${y})`} tabIndex={0} role="button" aria-label={`${p ? 'Process' : 'Resource'} ${id}${dead.has(id) ? ', deadlocked' : ''}`}
              onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); const q = toSvg(e); drag.current = { id, dx: q.x - x, dy: q.y - y, moved: false }; }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); } }}
            >
              {p ? (
                <>
                  <circle r={PR + 6} className="halo" />
                  <circle r={PR} className="shape" />
                  <text className="node-label" textAnchor="middle" dominantBaseline="central">{id}</text>
                </>
              ) : (
                <>
                  <rect x={-RW / 2 - 6} y={-RH / 2 - 6} width={RW + 12} height={RH + 12} rx={10} className="halo" />
                  <rect x={-RW / 2} y={-RH / 2} width={RW} height={RH} rx={6} className="shape" />
                  <text y={-7} className="node-label" textAnchor="middle" dominantBaseline="central">{id}</text>
                  {Array.from({ length: r!.instances }, (_, k) => (
                    <circle key={k} cx={(k - (r!.instances - 1) / 2) * 10} cy={10} r={3} className={`instance ${k < held ? 'held' : ''}`} />
                  ))}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- banker's algorithm

function hypothetical(s: BankerState, pid: number, req: number[]): BankerState {
  return { available: s.available.map((a, r) => a - req[r]), max: s.max, allocation: s.allocation.map((row, i) => (i === pid ? row.map((x, r) => x + req[r]) : row)) };
}

function BankerView({ d }: { d: DeadlockUi }) {
  const update = useSim((s) => s.update);
  const notify = useSim((s) => s.notify);
  const [draft, setDraft] = useState<{ pid: number; req: number[] }>(() => d.request ?? { pid: 1, req: [1, 0, 2].slice(0, d.banker.available.length) });
  const b = d.banker;
  const m = b.available.length;

  const run = useMemo((): { trace?: BankerTrace; req?: BankerRequestResult; error?: string[] } => {
    try {
      if (d.request) {
        const req = requestResources(b, d.request.pid, d.request.req, d.names);
        return { trace: req.trace ?? undefined, req };
      }
      return { trace: checkSafety(b, d.names) };
    } catch (e) {
      return { error: (e as Error).message.split('\n') };
    }
  }, [b, d.names, d.request]);

  const trace = run.trace;
  const total = trace?.steps.length ?? 1;
  const i = useStep(total);
  const shown = d.request && run.req?.trace ? (run.req.granted ? run.req.state : hypothetical(b, d.request.pid, d.request.req)) : b;
  const set = (patch: Partial<BankerState>) => update('deadlock', { banker: { ...b, ...patch }, request: null });
  const letters = Array.from({ length: m }, (_, r) => String.fromCharCode(65 + r));

  const resize = (n: number, k: number) => {
    const fit = (row: number[]) => Array.from({ length: k }, (_, r) => row[r] ?? 0);
    const rows = (mat: number[][]) => Array.from({ length: n }, (_, i) => fit(mat[i] ?? []));
    update('deadlock', {
      banker: { available: fit(b.available), max: rows(b.max), allocation: rows(b.allocation) },
      names: Array.from({ length: n }, (_, i) => d.names[i] ?? `P${i}`),
      request: null,
    });
    setDraft((dr) => ({ pid: Math.min(dr.pid, n - 1), req: fit(dr.req) }));
  };

  const controls = (
    <>
      <Panel label="Tool" index="01" id="tool">
        <KindSwitch d={d} />
        <div className="btn-row">
          <button type="button" className="btn ghost small" onClick={() => { update('deadlock', { banker: BANKER_BOOK, names: ['P0', 'P1', 'P2', 'P3', 'P4'], request: null }); setDraft({ pid: 1, req: [1, 0, 2] }); }}>Silberschatz §8.6.3.3</button>
        </div>
        <div className="field-row">
          <NumberField label="Processes" value={b.max.length} min={1} max={8} onChange={(n) => resize(n, m)} />
          <NumberField label="Resource types" value={m} min={1} max={5} onChange={(k) => resize(b.max.length, k)} />
        </div>
      </Panel>
      <Panel label="Request" index="◆" id="request">
        <p className="about">Pretend to grant it, then run the safety check. The banker only says yes if everyone could still finish.</p>
        <label className="field">
          <span>Process</span>
          <select value={draft.pid} onChange={(e) => setDraft({ ...draft, pid: Number(e.target.value) })}>
            {d.names.map((n, k) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <NumbersField label={`Amount (${letters.join(' ')})`} value={draft.req} onChange={(req) => setDraft({ ...draft, req })} />
        <div className="btn-row">
          <button type="button" className="btn primary small" onClick={() => { update('deadlock', { request: draft }); useSim.getState().setCursor(0); }}>Request</button>
          {d.request && <button type="button" className="btn ghost small" onClick={() => update('deadlock', { request: null })}>Clear</button>}
          {run.req?.granted && (
            <button type="button" className="btn accent small" onClick={() => { update('deadlock', { banker: run.req!.state, request: null }); notify('Grant committed. This is the new state.'); }}>Commit grant</button>
          )}
        </div>
      </Panel>
    </>
  );

  const step = trace?.steps[i];
  const finished = new Set(step?.state.finished ?? []);
  const need = shown.max.map((row, p) => row.map((x, r) => x - shown.allocation[p][r]));
  const editable = !d.request;

  const stage = !run.error && (
    <>
      {run.req && (
        <div className={`verdict ${run.req.granted ? 'ok' : run.req.reason === 'unsafe' ? 'dead' : 'warn'}`} role="status">
          <span className="verdict-dot" aria-hidden />
          <strong>{run.req.granted ? 'GRANTED' : run.req.reason === 'unsafe' ? 'DENIED · UNSAFE' : run.req.reason === 'not-available' ? 'MUST WAIT' : 'INVALID'}</strong>
          <span>{run.req.explain.summary}</span>
        </div>
      )}
      <Panel label={d.request && run.req?.trace ? 'State if granted' : 'System state'} index="02" id="matrices">
        <div className="table-wrap">
          <table className="data banker">
            <thead>
              <tr><th rowSpan={2}>Proc</th><th colSpan={m} className="grp">Allocation</th><th colSpan={m} className="grp">Max</th><th colSpan={m} className="grp">Need</th><th rowSpan={2} aria-label="Finished" /></tr>
              <tr>{[0, 1, 2].flatMap((g) => letters.map((l) => <th key={`${g}${l}`} className={g === 0 ? 'grp-start' : ''}>{l}</th>))}</tr>
            </thead>
            <tbody>
              {d.names.map((name, p) => {
                const picked = step?.state.picked === name;
                return (
                  <tr key={p} className={`${picked ? 'active' : ''} ${finished.has(name) && !picked ? 'finished' : ''}`}>
                    <th scope="row">{name}</th>
                    {shown.allocation[p].map((x, r) => (
                      <td key={`a${r}`} className={r === 0 ? 'grp-start' : ''}>
                        {editable ? <NumberField compact label={`${name} allocation ${letters[r]}`} value={x} max={99} onChange={(v) => set({ allocation: b.allocation.map((row, q) => (q === p ? row.map((y, s) => (s === r ? v : y)) : row)) })} /> : x}
                      </td>
                    ))}
                    {shown.max[p].map((x, r) => (
                      <td key={`m${r}`} className={r === 0 ? 'grp-start' : ''}>
                        {editable ? <NumberField compact label={`${name} max ${letters[r]}`} value={x} max={99} onChange={(v) => set({ max: b.max.map((row, q) => (q === p ? row.map((y, s) => (s === r ? v : y)) : row)) })} /> : x}
                      </td>
                    ))}
                    {need[p].map((x, r) => (
                      <td key={`n${r}`} className={`${r === 0 ? 'grp-start' : ''} need ${picked ? (x <= (step?.state.work[r] ?? 0) ? 'fits' : 'short') : ''}`}>{x}</td>
                    ))}
                    <td className="check">{finished.has(name) ? '✓' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Avail</th>
                {shown.available.map((x, r) => (
                  <td key={r} className={r === 0 ? 'grp-start' : ''}>
                    {editable ? <NumberField compact label={`Available ${letters[r]}`} value={x} max={99} onChange={(v) => set({ available: b.available.map((y, s) => (s === r ? v : y)) })} /> : x}
                  </td>
                ))}
                <td colSpan={2 * m + 1} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
      {step && (
        <Panel label="Safety check" index="03" id="safety">
          <div className="work">
            <div className="work-vec"><span className="q-label">Work</span><Vec v={step.state.work} letters={letters} /></div>
            {step.state.picked && (
              <>
                <span className="work-arrow" aria-hidden>+ {step.state.picked} releases →</span>
                <div className="work-vec"><Vec v={step.state.workAfter} letters={letters} hot /></div>
              </>
            )}
          </div>
          <div className="seq">
            <div className="q-label">Sequence</div>
            <ol className="seq-list">
              {d.names.map((_, k) => {
                const n = step.state.finished[k];
                return <li key={k} className={n ? 'filled' : 'slot'}>{n ?? '·'}</li>;
              })}
            </ol>
          </div>
        </Panel>
      )}
    </>
  );

  const label = (k: number) => {
    const s = trace?.steps[Math.min(k, total - 1)];
    return s ? (s.state.picked ? `pick ${s.state.picked}` : trace!.metrics.safe ? 'safe' : 'unsafe') : '—';
  };

  const explainSteps = trace?.steps ?? (run.req ? [{ explain: run.req.explain }] : []);
  return (
    <Layout
      controls={controls}
      stage={stage}
      explain={<ExplainPanel steps={explainSteps} i={Math.min(i, explainSteps.length - 1)} label={label} error={run.error}
        extra={run.req && trace ? <p className="explain-why">{run.req.explain.why}</p> : null} />}
      playback={trace && <Playback total={total} label={label} />}
    />
  );
}

function Vec({ v, letters, hot }: { v: number[]; letters: string[]; hot?: boolean }) {
  return (
    <span className={`vec ${hot ? 'hot' : ''}`}>
      {v.map((x, r) => <span key={r}><small>{letters[r]}</small>{x}</span>)}
    </span>
  );
}
