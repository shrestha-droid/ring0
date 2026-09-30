import { Component, useEffect, useRef, type ReactNode } from 'react';
import { MODULES, decodeScenario, encodeScenario, type ModuleId } from '../engine';
import { DEFAULTS, shareUrl, toEnvelope, useSim } from '../store';
import { downloadJson, svgToPng } from '../export';
import { Icon } from './icons';
import { isTyping } from './Playback';
import { SchedulerView } from './Scheduler';
import { MemoryView } from './Memory';
import { DeadlockView } from './Deadlock';
import { SyncView } from './Sync';

const TABS: { id: ModuleId; n: string; name: string; short: string; title: string[]; blurb: string }[] = [
  { id: 'scheduler', n: '01', name: 'CPU Scheduler', short: 'CPU', title: ['Who gets the ', 'CPU'], blurb: 'Six scheduling policies on one workload. Scrub the timeline to see every dispatch, preemption and context switch, and why it happened.' },
  { id: 'memory', n: '02', name: 'Virtual Memory', short: 'Memory', title: ['What gets ', 'evicted'], blurb: 'Page replacement, reference by reference. Watch frames fill, faults land and, with FIFO, more memory make things worse.' },
  { id: 'deadlock', n: '03', name: 'Deadlock Lab', short: 'Deadlock', title: ['Who waits ', 'forever'], blurb: 'Build a resource allocation graph and let the OS find the cycle, or play banker and only grant requests that keep everyone safe.' },
  { id: 'sync', n: '04', name: 'Synchronization', short: 'Sync', title: ['Which ', 'interleaving', ' breaks it'], blurb: 'Threads, one instruction at a time. Find the schedule that corrupts shared data, then add the semaphore that makes every schedule safe.' },
];

const SHORTCUTS: [string, string][] = [
  ['Space / K', 'Play or pause'],
  ['← → / J L', 'Step back / forward'],
  ['Shift + ← →', 'Jump 10 steps'],
  ['Home / End', 'First / last step'],
  ['[ ]', 'Slower / faster'],
  ['1 – 4', 'Switch module'],
  ['?', 'This panel'],
];

export function App() {
  const module = useSim((s) => s.module);
  const toast = useSim((s) => s.toast);
  const switched = useSim((s) => s.switched);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    document.documentElement.dataset.module = module;
  }, [module]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4) useSim.getState().setModule(MODULES[n - 1]);
      if (e.key === '?') dialog.current?.showModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <a className="skip" href="#stage">Skip to simulation</a>
      <header className="topbar">
        <a className="brand" href="./" aria-label="RING0 home">
          <RingMark />
          <span className="wordmark">RING<b>0</b></span>
          <span className="tagline">operating systems, <em>made visible</em></span>
        </a>
        <nav className="tabs" aria-label="Modules">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="tab" data-tab={t.id} aria-current={module === t.id ? 'page' : undefined} onClick={() => useSim.getState().setModule(t.id)} title={`${t.name} · ${t.n.slice(1)}`}>
              <span className="tab-n">{t.n}</span>
              <span className="tab-name">{t.name}</span>
              <span className="tab-short">{t.short}</span>
            </button>
          ))}
        </nav>
        <Actions onHelp={() => dialog.current?.showModal()} />
      </header>

      <main id="stage" className={`main ${switched ? 'enter' : ''}`} key={module}>
        <Intro tab={TABS.find((t) => t.id === module)!} />
        <ErrorBoundary>
          {module === 'scheduler' && <SchedulerView />}
          {module === 'memory' && <MemoryView />}
          {module === 'deadlock' && <DeadlockView />}
          {module === 'sync' && <SyncView />}
        </ErrorBoundary>
      </main>

      <dialog ref={dialog} className="dialog" aria-labelledby="kb-title" onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <h2 id="kb-title">Keyboard</h2>
        <dl className="kbd-list">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
          ))}
        </dl>
        <form method="dialog"><button className="btn">Close</button></form>
      </dialog>

      <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

function Actions({ onHelp }: { onHelp: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const { notify, load } = useSim.getState();

  const share = async () => {
    const url = shareUrl();
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      notify(`Link copied. It opens at step ${useSim.getState().cursor}.`);
    } catch {
      notify('Copy blocked by the browser. The address bar now holds the link.');
    }
  };

  const png = async () => {
    const svg = document.querySelector<SVGSVGElement>('#stage svg[data-export]');
    if (!svg) return notify('Nothing to export in this view.');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
    await svgToPng(svg, `ring0-${useSim.getState().module}.png`, bg);
  };

  const json = () => {
    const s = useSim.getState();
    downloadJson({ ...toEnvelope(s, s.module), cursor: s.cursor }, `ring0-${s.module}.json`);
  };

  const importJson = async (f: File) => {
    try {
      const env = JSON.parse(await f.text());
      // Round-trip through the share codec so imports get exactly the same checks as links.
      const decoded = decodeScenario(encodeScenario(env));
      if (decoded && load(decoded, Number(env.cursor) || 0)) notify(`Loaded ${f.name}.`);
      else notify("That file isn't a RING0 scenario.");
    } catch {
      notify("That file isn't valid JSON.");
    }
  };

  return (
    <div className="actions">
      <button type="button" className="btn primary" onClick={share} aria-label="Copy share link"><Icon name="share" size={16} /><span>Share</span></button>
      <button type="button" className="btn ghost" onClick={png} title="Export the main visual as PNG" aria-label="Export PNG"><Icon name="image" size={16} /><span>PNG</span></button>
      <button type="button" className="btn ghost" onClick={json} title="Export scenario as JSON" aria-label="Export JSON"><Icon name="download" size={16} /><span>JSON</span></button>
      <button type="button" className="btn ghost" onClick={() => file.current?.click()} title="Import a scenario JSON" aria-label="Import JSON"><Icon name="upload" size={16} /><span>Import</span></button>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />
      <button type="button" className="icon-btn" onClick={onHelp} aria-label="Keyboard shortcuts (?)" title="Shortcuts · ?"><Icon name="keyboard" /></button>
    </div>
  );
}

function Intro({ tab }: { tab: (typeof TABS)[number] }) {
  const [a, b, c = ''] = tab.title;
  return (
    <div className="intro">
      <h1><span className="intro-n">{tab.n} / {tab.name.toUpperCase()}</span>{a}<em>{b}</em>{c}?</h1>
      <p>{tab.blurb}</p>
    </div>
  );
}

function RingMark() {
  return (
    <svg className="ringmark" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="1" opacity=".35" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="38 12.3" className="ringmark-arc" />
      <circle cx="16" cy="16" r="2.5" fill="var(--accent)" />
    </svg>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h2>Something in this view broke.</h2>
        <p className="mono">{this.state.error.message}</p>
        <button
          type="button" className="btn primary"
          onClick={() => {
            const m = useSim.getState().module;
            useSim.setState({ [m]: DEFAULTS[m], cursor: 0 } as never);
            this.setState({ error: null });
          }}
        >
          Reset this module
        </button>
      </div>
    );
  }
}
