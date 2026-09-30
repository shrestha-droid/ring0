import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Explanation, Step } from '../engine';
import { useSim } from '../store';

/** Categorical slot for the i-th process/thread. Fixed order, never cycled: tables cap at 8. */
export const series = (i: number) => `var(--c${i % 8})`;
export const MAX_SERIES = 8;

export function Panel({ label, index, actions, children, className = '', id }: { label: string; index?: string; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`panel ${className}`} aria-labelledby={id && `${id}-h`}>
      <header className="panel-head">
        {index && <span className="panel-index">{index}</span>}
        <h2 id={id && `${id}-h`}>{label}</h2>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Layout({ controls, stage, explain, playback }: { controls: ReactNode; stage: ReactNode; explain: ReactNode; playback?: ReactNode }) {
  return (
    <>
      <div className="workspace">
        <div className="col col-controls">{controls}</div>
        <div className="col col-stage">{stage}</div>
        <div className="col col-explain">{explain}</div>
      </div>
      {playback}
    </>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Number input that lets you type freely and only commits whole numbers inside [min, max]. */
export function NumberField({ label, value, min = 0, max = 999, onChange, compact }: { label: string; value: number; min?: number; max?: number; onChange: (n: number) => void; compact?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className={`field ${compact ? 'compact' : ''}`}>
      {!compact && <span>{label}</span>}
      <input
        type="number" inputMode="numeric" min={min} max={max} value={text} aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

/** Text input for a list of numbers ("7 0 1 2"), committing on every parseable edit. */
export function NumbersField({ label, value, onChange, placeholder, compact }: { label: string; value: number[]; onChange: (xs: number[]) => void; placeholder?: string; compact?: boolean }) {
  const [text, setText] = useState(value.join(' '));
  useEffect(() => {
    setText((t) => (parseNumbers(t)?.join(' ') === value.join(' ') ? t : value.join(' ')));
  }, [value]);
  return (
    <label className={`field ${compact ? 'compact' : ''}`}>
      {!compact && <span>{label}</span>}
      <input
        type="text" inputMode="numeric" spellCheck={false} value={text} placeholder={placeholder} aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          const xs = parseNumbers(e.target.value);
          if (xs) onChange(xs);
        }}
      />
    </label>
  );
}

export function parseNumbers(s: string): number[] | null {
  const parts = s.trim().split(/[\s,]+/).filter(Boolean);
  const xs = parts.map(Number);
  return xs.every((x) => Number.isFinite(x)) ? xs : null;
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
      <span>{label}</span>
    </label>
  );
}

export function Errors({ messages }: { messages: string[] }) {
  return (
    <div className="errors" role="alert">
      <div className="errors-title">Can't run this scenario</div>
      <ul>{messages.map((m) => <li key={m}>{m}</li>)}</ul>
    </div>
  );
}

export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Clamp the global cursor to this trace. */
export function useStep(total: number) {
  const cursor = useSim((s) => s.cursor);
  return Math.max(0, Math.min(cursor, total - 1));
}

export function ExplainPanel({ steps, i, label, extra, error, codeSummary }: { steps: { explain: Explanation }[]; i: number; label?: (i: number) => string; extra?: ReactNode; error?: string[]; codeSummary?: boolean }) {
  const setCursor = useSim((s) => s.setCursor);
  const step = steps[i];
  const from = Math.max(0, i - 5);
  return (
    <Panel label="Explain" index="◉" className="explain" id="explain">
      {error ? (
        <Errors messages={error} />
      ) : step ? (
        <>
          <div className="explain-meta">
            <span>STEP {String(i).padStart(3, '0')}</span>
            <span>{label?.(i)}</span>
          </div>
          <p className="explain-summary" aria-live="polite">{codeSummary && i > 0 ? <code>{step.explain.summary}</code> : mono(step.explain.summary)}</p>
          <p className="explain-why">{step.explain.why}</p>
          {extra}
          {i > 0 && (
            <ol className="log" aria-label="Recent steps">
              {steps.slice(from, i).reverse().map((s, k) => {
                const idx = i - 1 - k;
                return (
                  <li key={idx}>
                    <button type="button" onClick={() => setCursor(idx)}>
                      <span className="log-i">{String(idx).padStart(3, '0')}</span>
                      <span>{s.explain.summary}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : null}
    </Panel>
  );
}

export type AnyStep = Step<unknown>;

/** Identifiers and numbers read ambiguously in the display serif (P1 vs Pl), so set them in mono. */
const TOKEN = /(\b[A-Za-z_]*\d+\b|\(\d+(?:, \d+)*\))/g;
export function mono(text: string) {
  return text.split(TOKEN).map((part, k) => (k % 2 ? <code key={k}>{part}</code> : part));
}

export const fmt = (n: number, d = 2) => (Number.isInteger(n) ? String(n) : n.toFixed(d));
export const pct = (n: number) => `${Math.round(n * 100)}%`;
