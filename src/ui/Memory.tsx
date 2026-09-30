import { useEffect, useMemo, useRef, useState } from 'react';
import { BELADY_PRESET, PAGE_ALGOS, SILBERSCHATZ_REFS, faultCurve, generateRefs, pageAlgoLabel, runPaging, type PageAlgo, type PagingState, type PagingTrace } from '../engine';
import { useSim, type MemoryUi } from '../store';
import { ExplainPanel, Layout, NumberField, NumbersField, Panel, Segmented, Stat, Toggle, pct, series, useStep, useWidth } from './common';
import { Icon } from './icons';
import { Playback } from './Playback';

const ABOUT: Record<PageAlgo, string> = {
  fifo: 'Evicts whichever page has been resident longest, however often it is used. Cheap, and the only one here that can get worse with more memory.',
  lru: 'Evicts the page unused for the longest time: the recent past as a guess about the near future. Needs hardware help to track use.',
  opt: 'Evicts the page needed furthest in the future. Impossible in a real OS, but it is the yardstick every other algorithm is measured against.',
  clock: 'A cheap LRU approximation. A hand sweeps the frames; a set reference bit buys a page one more lap (its second chance).',
};

export function MemoryView() {
  const m = useSim((s) => s.memory);
  const run = useMemo(() => {
    try {
      return { trace: runPaging(m), error: undefined };
    } catch (e) {
      return { trace: undefined, error: (e as Error).message.split('\n') };
    }
  }, [m]);
  const trace = run.trace;
  const total = trace?.steps.length ?? 1;
  const i = useStep(total);
  const label = (k: number) => (trace ? `ref ${k + 1} · page ${m.refs[k]}` : '—');

  return (
    <Layout
      controls={<Controls m={m} />}
      stage={trace && (
        <>
          <Panel label="Frames" index="02" id="frames" actions={<FrameLegend />}>
            <FrameStats trace={trace} i={i} />
            <FrameGrid trace={trace} refs={m.refs} frames={m.frames} i={i} clock={m.algo === 'clock'} />
          </Panel>
          <div className="split">
            <Panel label={m.tlbEntries ? 'Page table · TLB' : 'Page table'} index="03" id="pagetable">
              <PageTable state={trace.steps[i].state} refs={m.refs} />
            </Panel>
            <Panel label="Faults vs. frames" index="04" id="curve">
              <FaultCurve refs={m.refs} frames={m.frames} algo={m.algo} />
            </Panel>
          </div>
        </>
      )}
      explain={<ExplainPanel steps={trace?.steps ?? []} i={i} label={label} error={run.error} />}
      playback={<Playback total={total} label={label} marks={trace?.steps.filter((s) => s.state.fault).map((s) => s.index)} />}
    />
  );
}

function Controls({ m }: { m: MemoryUi }) {
  const update = useSim((s) => s.update);
  const notify = useSim((s) => s.notify);
  const distinct = new Set(m.refs).size;
  const set = (patch: Partial<MemoryUi>) => { update('memory', patch); useSim.getState().setCursor(0); };
  return (
    <>
      <Panel label="Reference string" index="01" id="refs">
        <NumbersField label="Pages, in order" value={m.refs} onChange={(refs) => update('memory', { refs })} placeholder="7 0 1 2 0 3" />
        <p className="hint">{m.refs.length} references · {distinct} distinct pages</p>
        <div className="btn-row">
          <button type="button" className="btn ghost small" onClick={() => { const seed = m.seed + 1; set({ seed, refs: generateRefs({ seed, length: 20, pages: 8, locality: 0.45 }) }); }}>
            <Icon name="dice" size={14} />Random
          </button>
          <button type="button" className="btn ghost small" onClick={() => set({ refs: SILBERSCHATZ_REFS, frames: 3 })}>Silberschatz</button>
          <button
            type="button" className="btn accent small"
            onClick={() => { set({ refs: BELADY_PRESET.refs, frames: 3, algo: 'fifo' }); notify('FIFO, 3 frames: 9 faults. Now try 4 frames.'); }}
          >
            Belady's anomaly
          </button>
        </div>
      </Panel>
      <Panel label="Replacement" index="◆" id="replacement">
        <Segmented<PageAlgo> label="Replacement algorithm" value={m.algo} options={PAGE_ALGOS.map((a) => ({ value: a, label: pageAlgoLabel[a] }))} onChange={(algo) => update('memory', { algo })} />
        <p className="about">{ABOUT[m.algo]}</p>
        <NumberField label="Physical frames" value={m.frames} min={1} max={12} onChange={(frames) => update('memory', { frames })} />
        <Toggle label="TLB" checked={!!m.tlbEntries} onChange={(on) => update('memory', { tlbEntries: on ? 2 : undefined })} />
        {m.tlbEntries && <NumberField label="TLB entries" value={m.tlbEntries} min={1} max={8} onChange={(tlbEntries) => update('memory', { tlbEntries })} />}
      </Panel>
    </>
  );
}

function FrameStats({ trace, i }: { trace: PagingTrace; i: number }) {
  const s = trace.steps[i].state;
  const tlbHits = trace.steps.slice(0, i + 1).filter((x) => x.state.tlbHit).length;
  return (
    <div className="stats compact">
      <Stat label="Faults" value={<>{s.faults}<small>/{trace.metrics.faults}</small></>} tone="bad" />
      <Stat label="Hits" value={s.hits} tone="good" />
      <Stat label="Fault rate" value={pct(s.faults / (i + 1))} sub={`final ${pct(trace.metrics.faultRate)}`} />
      {s.tlb && <Stat label="TLB hit rate" value={pct(tlbHits / (i + 1))} />}
    </div>
  );
}

function FrameLegend() {
  return (
    <div className="legend">
      <span><i className="lg-fault" />fault</span>
      <span><i className="lg-hit" />hit</span>
      <span><i className="lg-victim" />evicted</span>
    </div>
  );
}

function FrameGrid({ trace, refs, frames, i, clock }: { trace: PagingTrace; refs: number[]; frames: number; i: number; clock: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const setCursor = useSim((s) => s.setCursor);
  const C = 32, padL = 38, top = 30;
  const W = padL + refs.length * C + 8;
  const H = top + frames * C + 44;
  const x = (c: number) => padL + c * C;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const left = x(i) - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, left), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid-scroll" ref={scroller}>
      <svg data-export width={W} height={H} role="img" aria-label={`Frame contents after each of ${refs.length} references; ${trace.metrics.faults} faults in total.`}>
        <rect x={x(i)} y={4} width={C} height={H - 8} rx={4} className="col-now" />
        {refs.map((r, c) => (
          <g key={c} onClick={() => setCursor(c)} className="col-hit">
            <rect x={x(c)} y={0} width={C} height={H} fill="transparent" />
            <text x={x(c) + C / 2} y={16} textAnchor="middle" className={`ref-label ${c === i ? 'now' : c > i ? 'future' : ''}`}>{r}</text>
          </g>
        ))}
        {Array.from({ length: frames }, (_, f) => (
          <text key={f} x={padL - 8} y={top + f * C + C / 2} textAnchor="end" dominantBaseline="central" className="row-label">F{f}</text>
        ))}
        {trace.steps.slice(0, i + 1).map(({ state: s }, c) => (
          <g key={c}>
            {s.frames.map((pg, f) => {
              const loaded = s.fault && pg === s.page;
              const hit = s.hit && pg === s.page;
              return (
                <g key={f}>
                  <rect x={x(c) + 2} y={top + f * C + 2} width={C - 4} height={C - 4} rx={3} className={`fcell ${pg === null ? 'empty' : ''} ${loaded ? 'loaded' : ''} ${hit ? 'hit' : ''}`} />
                  {pg !== null && <text x={x(c) + C / 2} y={top + f * C + C / 2} textAnchor="middle" dominantBaseline="central" className={`cell-text ${loaded ? 'on-accent' : ''}`}>{pg}</text>}
                  {clock && s.refBit?.[f] === 1 && pg !== null && <circle cx={x(c) + C - 7} cy={top + f * C + 7} r={2} className="refbit" />}
                </g>
              );
            })}
            <text x={x(c) + C / 2} y={top + frames * C + 14} textAnchor="middle" className={s.fault ? 'mark-fault' : 'mark-hit'}>{s.fault ? 'F' : '✓'}</text>
            {s.victim !== null && <text x={x(c) + C / 2} y={top + frames * C + 30} textAnchor="middle" className="mark-victim">−{s.victim}</text>}
          </g>
        ))}
        {clock && trace.steps[i].state.hand !== undefined && (
          <path d={`M${x(i) + C + 1},${top + trace.steps[i].state.hand! * C + C / 2} l6,-5 v10 z`} className="clock-hand"><title>Clock hand</title></path>
        )}
      </svg>
    </div>
  );
}

function PageTable({ state: s, refs }: { state: PagingState; refs: number[] }) {
  const pages = [...new Set(refs)].sort((a, b) => a - b);
  return (
    <div className="pt">
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">Page table at this step</caption>
          <thead><tr><th>Page</th><th>Frame</th><th>Valid</th></tr></thead>
          <tbody>
            {pages.map((p) => {
              const f = s.pageTable[p];
              return (
                <tr key={p} className={p === s.page ? 'active' : f === undefined ? 'pending' : ''}>
                  <td>{p}</td><td>{f ?? '—'}</td><td><span className={`bit ${f !== undefined ? 'on' : ''}`}>{f !== undefined ? 1 : 0}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {s.tlb && (
        <div className="tlb">
          <div className="tlb-head">
            <span className="q-label">TLB</span>
            <span className={`badge ${s.tlbHit ? 'good' : 'bad'}`}>{s.tlbHit ? 'hit' : 'miss'}</span>
          </div>
          <ol className="tlb-list" aria-label="TLB entries, least to most recently used">
            {s.tlb.map((e) => (
              <li key={e.page} className={e.page === s.page ? 'active' : ''}><span>p{e.page}</span><span aria-hidden>→</span><span>f{e.frame}</span></li>
            ))}
          </ol>
          <p className="hint">LRU order, oldest first. Evicting a page also drops its TLB entry.</p>
        </div>
      )}
    </div>
  );
}

function FaultCurve({ refs, frames, algo }: { refs: number[]; frames: number; algo: PageAlgo }) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const update = useSim((s) => s.update);
  const maxF = Math.min(12, Math.max(frames + 1, Math.min(new Set(refs).size, 8)));
  const curves = useMemo(() => PAGE_ALGOS.map((a) => ({ a, ys: faultCurve(refs, a, maxF) })), [refs, maxF]);
  const fifo = curves[0].ys;
  const belady = fifo.flatMap((y, k) => (k > 0 && y > fifo[k - 1] ? [k] : [])); // index k: rise from k to k+1 frames

  const w = Math.max(260, width || 320), h = 210;
  const padL = 34, padR = 64, padT = 14, padB = 30;
  const maxY = Math.max(...curves.flatMap((c) => c.ys), 1);
  const x = (f: number) => padL + ((f - 1) / Math.max(1, maxF - 1)) * (w - padL - padR);
  const y = (v: number) => padT + (1 - v / maxY) * (h - padT - padB);
  const yTicks = [0, Math.round(maxY / 2), maxY];
  const framesAt = (e: React.PointerEvent | React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(1, Math.min(maxF, Math.round(1 + ((e.clientX - r.left - padL) / (w - padL - padR)) * (maxF - 1))));
  };
  // Direct labels at the line ends, nudged apart so equal end values don't overprint.
  const labelY: number[] = [];
  curves.map((c, k) => ({ k, y: y(c.ys.at(-1)!) })).sort((a, b) => a.y - b.y)
    .reduce((prev, l) => { labelY[l.k] = Math.max(l.y, prev + 12); return labelY[l.k]; }, -Infinity);

  return (
    <div ref={wrap} className="curve">
      <svg width={w} height={h} role="img" aria-label="Page faults for 1 to N frames, one line per algorithm"
        onPointerMove={(e) => setHover(framesAt(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => update('memory', { frames: framesAt(e) })}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={padL - 8} y={y(t)} textAnchor="end" dominantBaseline="central" className="tick-label">{t}</text>
          </g>
        ))}
        {Array.from({ length: maxF }, (_, k) => <text key={k} x={x(k + 1)} y={h - padB + 16} textAnchor="middle" className="tick-label">{k + 1}</text>)}
        <text x={w - padR} y={h - 4} textAnchor="end" className="axis-title">frames</text>
        <line x1={x(frames)} x2={x(frames)} y1={padT} y2={h - padB} className="cursor-line" />
        {belady.map((k) => (
          <g key={k} className="belady">
            <rect x={x(k)} y={padT} width={x(k + 1) - x(k)} height={h - padT - padB} />
            <text x={(x(k) + x(k + 1)) / 2} y={padT + 10} textAnchor="middle">▲ Belady</text>
          </g>
        ))}
        {curves.map(({ a, ys }, k) => (
          <g key={a} className={`series ${a === algo ? 'active' : ''}`} style={{ '--s': series(k) } as React.CSSProperties}>
            <polyline points={ys.map((v, f) => `${x(f + 1)},${y(v)}`).join(' ')} />
            {ys.map((v, f) => <circle key={f} cx={x(f + 1)} cy={y(v)} r={f + 1 === frames && a === algo ? 5 : 3} />)}
            <text x={w - padR + 8} y={labelY[k]} dominantBaseline="central" className="direct-label">{pageAlgoLabel[a]}</text>
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={h - padB} className="hover-line" />}
      </svg>
      <div className="curve-readout mono" aria-live="off">
        {(() => {
          const f = hover ?? frames;
          return <>
            <span className="muted">{f} frame{f > 1 ? 's' : ''}</span>
            {curves.map(({ a, ys }, k) => <span key={a}><i style={{ background: series(k) }} />{pageAlgoLabel[a]} {ys[f - 1]}</span>)}
          </>;
        })()}
      </div>
      {belady.length > 0 && <p className="hint warn">FIFO faults more with {belady.map((k) => `${k + 1}`).join(', ')} frames than with one fewer. Stack algorithms (LRU, Optimal) can't do this.</p>}
      {belady.length === 0 && <p className="hint">Click the chart to try that many frames.</p>}
    </div>
  );
}
