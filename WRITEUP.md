# RING0 — design decisions

This is the reasoning behind how RING0 is built. Each section states the decision and the trade-off.

---

## 1. A simulation is a function from scenario to trace

Every module exposes `simulate(params) → { steps[], metrics }`. Each step is a full, immutable snapshot of OS state, plus an `Explanation { summary, why }`.

- **Time travel is free.** Stepping back is `steps[i - 1]`. There is no reverse execution, undo log or replay-from-zero.
- **Determinism is easy to test.** Run twice, `toEqual`. Round-trip through JSON, `toEqual`.
- **Cost:** memory grows with steps × state size. At textbook scale (hundreds of steps, a few processes) that is kilobytes. A 100,000-tick simulation would want deltas or checkpoints instead.


## 2. The engine writes the explanations

The "why" text is produced inside the scheduler, pager, banker and VM, at the moment they choose. It uses the same numbers they compared: "SJF picks the lowest next CPU burst: P4(3) over P1(6), P2(8), P3(7)." The UI never infers reasons after the fact.

- The Explain panel cannot drift out of sync with the algorithm.
- Tests assert on explanation strings, so a wrong explanation is a failing test.


## 3. Only the scenario is state

The Zustand store holds a scenario per module, the cursor and playback flags. Traces are derived with `useMemo`. Share links and JSON export are the same `{ v: 1, module, params }` envelope: lz-string compressed into the URL hash. The hash never reaches a server, and `v` leaves room for migrations.

Links and imported files are untrusted input. `store.ts → accept()` runs the engine on incoming params and rejects anything it can't run. The engine's validators are the schema.


## 4. Scheduler: one tick loop, policies as a selection key

All six algorithms share one loop. Each tick it does aging, then MLFQ boost, then admissions, then preemption, then dispatch, then execution. Each algorithm is mostly a choice of selection key: remaining burst, effective priority, queue level, or nothing (FIFO order). Ties always go to the process that has waited in the ready queue longest. A new arrival at time *t* queues ahead of a process preempted at *t*, which is the usual textbook convention.

Choices that change numbers, all documented in `scheduler/types.ts`:

- Context-switch cost defaults to 0, because that's what textbook answers assume.
- MLFQ demotes on a full quantum. It keeps a process's level when it is preempted by a higher queue or leaves for I/O.
- Aging resets a process's priority when it leaves the CPU.


## 5. Deadlock detection by reduction, not just cycle finding

A cycle in a resource allocation graph proves deadlock only when every resource has one instance. RING0 uses graph reduction (Silberschatz §8.7.2), which is exact for multi-instance resources. It finds a cycle separately, only to draw it. That is why it can say "cycle, but no deadlock".

The banker's scan continues from the last process it picked. On the book example that finds ⟨P1, P3, P4, P0, P2⟩. The book quotes ⟨P1, P3, P4, P2, P0⟩; both are safe, and the test checks both.


## 6. Synchronization runs on a register machine

Threads are programs in a ten-instruction ISA: `load`, `store`, `add`, `set`, `wait`, `signal`, `put`, `get`, `jz` and `jmp`. Real threads or JavaScript generators would hide the thing being taught. Here, `counter++` is literally three instructions, and the scheduler chooses who runs each one.

- **Lost updates are detected precisely.** Every store bumps a per-variable version. A thread storing after someone else stored since its load has clobbered a write.
- **`findViolation` is breadth-first search over interleavings**, pruning repeated states. So the bad schedule it finds is the shortest one.
- **Ceiling:** the state space is exponential. It is instant for two to four small threads. Larger programs would need partial-order reduction.


## 7. Rendering and performance

- Plain SVG instead of Canvas/WebGL. The data is tiny, SVG stays accessible (labels, `role="img"`, table equivalents), exports cleanly to PNG, and needs no chart library.
- The default view is pre-rendered at build time and hydrated. Without it Lighthouse performance was 80, because first paint waited for JavaScript. With it, 100.
- Fonts load without blocking. Motion respects `prefers-reduced-motion`.


## 8. Visual design

- A dark "instrument panel" look: a faint grid, hairline panels, corner brackets.
- Serif headlines for voice, and mono for anything that is data.
- One accent per module: amber for CPU, teal for memory, coral for deadlock, violet for sync. It is a single CSS variable swapped on `<html data-module>`.
- Process and thread colours come from a fixed categorical palette. It was checked for colour-blind separation and 3:1 contrast against the panel. Colour is never the only cue: every bar and lane is also labelled.
- Status colours (good, warning, critical) are reserved. They never stand in for a series.


## 9. Known limits

- Time is integer ticks; no fractional quanta.
- At most eight processes or threads, so colours are never reused.
- The allocation graph has no reduction animation yet. The verdict and finish order are shown statically.
- Sync programs are edited through presets, not a code editor.

