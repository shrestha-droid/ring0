import { useEffect } from 'react';
import { useSim } from '../store';
import { Icon } from './icons';

const SPEEDS = [0.5, 1, 2, 4];

export const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || (el instanceof HTMLInputElement && el.type !== 'range' && el.type !== 'checkbox') || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement);

/** Play/pause/step/scrub for whatever trace the current module shows. One step = one engine Step. */
export function Playback({ total, label, marks }: { total: number; label: (i: number) => string; marks?: number[] }) {
  const cursor = useSim((s) => s.cursor);
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const { setCursor, setPlaying, setSpeed } = useSim.getState();
  const last = Math.max(0, total - 1);
  const i = Math.min(cursor, last);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const c = useSim.getState().cursor;
      if (c >= last) setPlaying(false);
      else setCursor(c + 1);
    }, 700 / speed);
    return () => clearInterval(id);
  }, [playing, speed, last, setCursor, setPlaying]);

  const toggle = () => {
    if (!playing && i >= last) setCursor(0);
    setPlaying(!playing);
  };
  const go = (n: number) => {
    setPlaying(false);
    setCursor(Math.max(0, Math.min(last, n)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const c = Math.min(useSim.getState().cursor, last);
      const big = e.shiftKey ? 10 : 1;
      const k = e.key;
      if (k === ' ' || k === 'k') {
        if (e.target instanceof HTMLButtonElement && k === ' ') return; // the button's own click handles it
        e.preventDefault();
        toggle();
      } else if (k === 'ArrowRight' || k === 'l') { e.preventDefault(); go(c + big); }
      else if (k === 'ArrowLeft' || k === 'j') { e.preventDefault(); go(c - big); }
      else if (k === 'Home') { e.preventDefault(); go(0); }
      else if (k === 'End') { e.preventDefault(); go(last); }
      else if (k === ']') setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(useSim.getState().speed) + 1)]);
      else if (k === '[') setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(useSim.getState().speed) - 1)]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const progress = last ? i / last : 1;
  return (
    <div className="playback" role="toolbar" aria-label="Playback">
      <div className="pb-buttons">
        <button type="button" className="icon-btn" onClick={() => go(0)} aria-label="Jump to start (Home)" title="Start · Home"><Icon name="first" /></button>
        <button type="button" className="icon-btn" onClick={() => go(i - 1)} aria-label="Step back (←)" title="Step back · ←"><Icon name="prev" /></button>
        <button type="button" className="icon-btn play" onClick={toggle} aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} title="Play/pause · Space">
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button type="button" className="icon-btn" onClick={() => go(i + 1)} aria-label="Step forward (→)" title="Step forward · →"><Icon name="next" /></button>
        <button type="button" className="icon-btn" onClick={() => go(last)} aria-label="Jump to end (End)" title="End · End"><Icon name="last" /></button>
      </div>
      <div className="pb-track">
        <input
          className="scrubber" type="range" min={0} max={last} value={i} aria-label="Timeline" aria-valuetext={label(i)}
          style={{ '--p': progress } as React.CSSProperties}
          onChange={(e) => go(Number(e.target.value))}
        />
        {marks && last > 0 && (
          <div className="pb-marks" aria-hidden>
            {marks.map((m) => <span key={m} style={{ left: `${(m / last) * 100}%` }} />)}
          </div>
        )}
      </div>
      <div className="pb-readout">
        <output className="pb-label">{label(i)}</output>
        <span className="pb-count">{String(i).padStart(String(last).length, '0')}<i>/</i>{last}</span>
      </div>
      <label className="pb-speed">
        <span className="sr-only">Speed</span>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
    </div>
  );
}
