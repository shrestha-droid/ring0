# RING0 — architecture (engine built: milestones 1–4; UI next)

## Repo structure

```
ring0/
├─ ARCHITECTURE.md            this file
├─ README.md                  (M6) GIFs + architecture notes
├─ WRITEUP.md                 (M6) design decisions, TODO markers for your own explanations
├─ package.json / vite.config.ts / tsconfig.json / vercel.json
├─ index.html
├─ src/
│  ├─ engine/                 PURE TS. No react, no DOM, no clock, no unseeded randomness. Enforced by purity.test.ts.
│  │  ├─ core/                types.ts (Step, Trace, Explanation, ScenarioEnvelope) · rng.ts (mulberry32) · share.ts (URL encode/decode) · core.test.ts
│  │  ├─ scheduler/           types.ts · run.ts (all six policies, one tick loop) · presets.ts (textbook workloads) · scheduler.test.ts
│  │  ├─ memory/              types.ts · run.ts (FIFO/LRU/OPT/Clock, TLB, fault curve, generator) · memory.test.ts
│  │  ├─ deadlock/            types.ts · run.ts (graph reduction, cycle, banker) · presets.ts (book graphs, dining philosophers) · deadlock.test.ts
│  │  ├─ sync/                types.ts · run.ts (register VM, interleaving search) · presets.ts · sync.test.ts
│  │  ├─ purity.test.ts
│  │  └─ index.ts             the one import surface for the UI
│  ├─ store/
│  │   └─ useSim.ts           Zustand: { module, scenario, cursor, playing, speed }. Trace is derived (useMemo), never stored.
│  ├─ ui/
│  │  ├─ shell/               Header, module tabs, playback bar, Explain panel, export menu, shortcuts
│  │  ├─ scheduler/           ProcessTable, Gantt (SVG), ReadyQueue, MetricsCards, CompareGrid
│  │  ├─ memory/              FrameGrid, RefStrip, PageTable, Tlb, FaultCurve
│  │  ├─ deadlock/            RagCanvas (SVG + d3-drag), BankerTable, SafeSequence
│  │  ├─ sync/                ThreadLanes, SharedState, InterleavingStepper
│  │  └─ theme/               tokens.css (one accent per module), fonts
│  ├─ export/                 svgToPng.ts, downloadJson.ts
│  └─ main.tsx
└─ tests/ (only e2e smoke later; engine tests sit next to the engine)
```

## Key decisions

1. **Scenario in, trace out.** Every module is `simulate(params) => { steps[], metrics }`. A step is a full immutable snapshot, so time travel is `steps[cursor]`. Stepping back, scrubbing and determinism cost nothing extra. Traces are small (hundreds of steps); no reverse-execution machinery needed.
2. **Only the scenario is state.** The Zustand store holds scenario + cursor + playback flags. All of it is JSON, which gives share links and JSON export in one mechanism. The trace is recomputed on change.
3. **One contract, four modules.** `Step<S>` carries an `Explanation {summary, why}` produced by the engine at the moment of the decision, so the Explain panel can never disagree with the algorithm. Tests assert on these strings for key steps.
4. **Compare mode is free.** `compareSchedulers` runs the same `procs` through N algos. The UI only lays traces out side by side and shares one cursor.
5. **Determinism rules.** Fixed tie-break (earlier arrival, then process order). No time or randomness inside the engine; generators take a seed stored in the scenario.
6. **Rendering.** SVG + a little d3 (scales, drag) instead of WebGL. The datasets are tiny, SVG gives crisp PNG export (serialise to canvas), good a11y, and trivially meets Lighthouse 90. WebGL would add weight for no visible gain.
7. **Share links.** `#s=<lz-string(JSON(envelope))>`. `v:1` field for migrations. Hash (not query) so nothing hits a server. One small dependency (lz-string); the native CompressionStream is async and awkward in the synchronous decode path on load.
8. **Deploy.** Vercel, static.

## Engine API (see the `types.ts` in each folder for the full shapes)

| Module | Entry points |
|---|---|
| scheduler | `runScheduler(params)`, `compareSchedulers(procs, algos)`, `validateProcs(procs)` |
| memory | `runPaging(params)`, `faultCurve(refs, algo, maxFrames)`, `generateRefs(p)`, `BELADY_PRESET` |
| deadlock | `detectDeadlock(rag)`, `checkSafety(state)`, `requestResources(state, pid, req)`, `diningPhilosophers(n)` |
| sync | `runSync(params)`, `findViolation(params, maxDepth)` |

## Open choices I defaulted (say so if you want them changed)

- **Time unit = integer ticks.** Textbook examples are integer; fractional quanta are not supported.
- **Context-switch cost defaults to 0**, since textbook numbers assume it. The Gantt still draws the markers.
- **Priority: lower number = higher priority.**
- **Sync uses a small register-machine instruction set** instead of real threads or generators. It makes "step one instruction" literal and lets `findViolation` exhaustively search interleavings.
- **Clock/MLFQ details:** Clock sets the reference bit on load and the hand stops just past the replaced frame; MLFQ demotes on full-quantum use, keeps its level when it leaves for I/O or is preempted by a higher level.
- **Banker scan order:** each round continues from the last process picked, so it finds ⟨P1, P3, P4, P0, P2⟩ for the book example (the book quotes ⟨P1, P3, P4, P2, P0⟩, also safe; the test checks both).

## Milestones

| # | Deliverable | Gate |
|---|---|---|
| 0 | This design + types | done |
| 1 | Project scaffold + `core` + scheduler engine + tests | done |
| 2 | memory engine + tests (incl. Belady 9→10) | done |
| 3 | deadlock engine + tests (Silberschatz banker example) | done |
| 4 | sync engine + tests | done |
| 5 | UI, one module at a time, shell + time travel + share + export | Lighthouse ≥ 90 |
| 6 | README with GIFs, WRITEUP.md with TODOs, deploy | live URL |

## Textbook sources the tests will cite

- Scheduling: Silberschatz, *Operating System Concepts* 10e, §5.3 (FCFS avg wait 17; SJF avg wait 7; RR q=4 avg wait 5.66), and SRTF example §5.3.2.
- Paging: Silberschatz §10.4 (FIFO 15 faults, LRU 12, OPT 9 on the 20-ref string, 3 frames); Belady string 1,2,3,4,1,2,5,1,2,3,4,5 (9 faults @3 frames, 10 @4).
- Banker's: Silberschatz §8.6.3.3 (5 processes, 3 resource types; request examples for P1, P4, P0). Detection: §8.7.2. RAG figures: §8.3.2.
- Sync: Silberschatz §6.1 (count++/count-- race, ends at 4), §7.1.1 bounded buffer, §7.1.2 readers-writers, §6.8.3 opposite-order deadlock.
- MLFQ: Arpaci-Dusseau, *OSTEP* ch. 8, Figure 8.3.
