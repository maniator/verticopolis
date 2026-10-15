# Read model shape (npm run perf:worker -- --read-model)

> **Snapshot, measured 2026-10-15T21:02:08.260Z on commit `df59d0d` (app 2.34.1), Node v22.22.0.** Live numbers: re-run `npm run perf:worker -- --read-model` (src/tests/perfWorker/readModel.ts, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts).

- A fresh load, then 720 steps of 2 minutes in batches of 4
- Scenarios: small (`8018a9e05910`), medium (`159b444c6a65`), large (`e0db69ea4891`)

## read model

Measured once per scenario on the TypeScript engine in Node (see the limitations). Shares are of the whole save in JSON characters. A merge is counted where the worker host merges; "changed" is units present in both saves whose records differ, as a share of the units present and as counts; "outside the frame" counts the changed units with at least one changed field the frame view's unit record does not carry. Merges are by reason (hour pass, revision or both).

| scenario | save | units | top-level keys | unit kinds | merges | share of units changed per merge, median / max | units changed per merge, median / mean / max | units touched per merge, median / mean / max | changed outside the frame, median / mean / max | unit fields changed | top-level keys changed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| small | 109,161 chars | 2,240 | units 99.0%, log 0.3%, transports 0.2%, events 0.05%, 22 more 0.1% | floor (1,960) 79.0%, office (104) 9.0%, lobby (140) 5.4%, condo (35) 3.5%, 1 more 0.05% | 24 (24 hour) | 1.5% / 6.3% | 34 / 43.7 / 140 | 34 / 43.7 / 140 | 34 / 38.1 / 140 | occupants, patronageToday, patronageYest, pendingIncome, profitToday, profitYest, satisfaction, state | events, ledger, minutes, money, seed, transports, units |
| medium | 648,859 chars | 12,062 | units 96.7%, excavated 1.5%, ledger 1.1%, transports 0.6%, 22 more 0.05% | floor (10,129) 70.1%, office (379) 7.6%, lobby (830) 5.7%, condo (215) 4.1%, 13 more 7.3% | 24 (24 hour) | 0.1% / 2.1% | 17 / 56.3 / 258 | 17 / 56.3 / 258 | 13 / 15.2 / 126 | occupants, patronageToday, patronageYest, pendingIncome, profitToday, profitYest, satisfaction, state | events, ledger, log, minutes, money, seed, transports, units |
| large | 2,157,388 chars | 43,358 | units 99.9%, transports 0.03%, log 0.01%, milestones <0.01%, 22 more <0.01% | floor (40,083) 84.3%, office (2,886) 12.8%, lobby (375) 0.7%, recycling (9) 0.03%, 4 more 0.02% | 24 (24 hour) | <0.01% / 6.7% | 0.5 / 673.9 / 2,888 | 0.5 / 673.9 / 2,888 | 0 / 553.5 / 2,886 | occupants, satisfaction, state, vacateAt, vacateReason | events, ledger, log, minutes, money, seed, transports, units |

## Limitations

- The read model section is measured in Node on the TypeScript engine, not in the browser: each scenario loads its save fresh, as the timed hosted run does after its throwaway warm-up, then runs the hosted rows' 720 steps in batches of 4, and a merge is counted after each batch where the worker host merges by its own rule (the hour-pass counter or the tower revision moved). The merges a host forces after a stale reply or for a settle are left out. Sizes are JSON characters of each value. The WASM engine reaches the same end state (the hosted end-state digests), but its intermediate saves were not compared.
