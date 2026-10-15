# Read model shape (npm run perf:worker -- --read-model)

> **Snapshot, measured 2026-10-15T20:52:39.023Z on commit `209dfbe` (app 2.34.1), Node v22.22.0.** Live numbers: re-run `npm run perf:worker -- --read-model` (src/tests/perfWorker/readModel.ts, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts).

- 120 warm steps, then 720 steps of 2 minutes in batches of 4
- Scenarios: small (`8018a9e05910`), medium (`159b444c6a65`), large (`e0db69ea4891`)

## read model

Measured once per scenario on the TypeScript engine in Node (see the limitations). Shares are of the whole save in JSON characters. A merge is counted where the worker host merges; "changed" is units present in both saves whose records differ, as a share of the units present; "outside the frame" counts the changed units whose changed fields are all ones the frame view's unit record does not carry.

| scenario | save | units | top-level keys | unit kinds | merges | units changed per merge, median / max | units touched per merge, median / max | changed outside the frame, median / max | unit fields changed | top-level keys changed |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 114,553 chars | 2,240 | units 98.9%, transports 0.4%, log 0.3%, events 0.05%, 22 more 0.1% | floor (1,960) 75.3%, office (104) 11.9%, lobby (140) 5.2%, condo (35) 4.4%, 1 more 0.2% | 24 | 1.5% / 5.0% | 34 / 112 | 33.5 / 34 | occupants, patronageToday, patronageYest, pendingIncome, profitToday, profitYest, satisfaction | events, ledger, minutes, money, seed, transports, units |
| medium | 649,169 chars | 12,062 | units 96.7%, excavated 1.5%, ledger 1.1%, transports 0.6%, 22 more 0.05% | floor (10,129) 70.1%, office (379) 7.6%, lobby (830) 5.7%, condo (215) 4.1%, 13 more 7.3% | 24 | 0.1% / 2.1% | 17 / 258 | 9 / 20 | occupants, patronageToday, patronageYest, pendingIncome, profitToday, profitYest, satisfaction, state | events, lastQuarterMoney, ledger, log, minutes, money, seed, transports, units |
| large | 2,336,909 chars | 43,358 | units 99.9%, transports 0.04%, log 0.02%, milestones <0.01%, 22 more <0.01% | floor (40,083) 77.9%, office (2,886) 19.5%, lobby (375) 0.7%, recycling (9) 0.02%, 4 more 0.02% | 24 | 0.0% / 6.7% | 0 / 2887 | 0 / 70 | dirtyDays, occupants, satisfaction, state, vacateAt, vacateReason | events, ledger, log, minutes, seed, transports, units |

## Limitations

- The read model section is measured in Node on the TypeScript engine, not in the browser: each scenario runs 120 warm steps, then the hosted rows' 720 steps in batches of 4, and a merge is counted after each batch where the worker host would merge (the hour-pass counter or the tower revision moved). Sizes are JSON characters of each value. The WASM engine reaches the same end state (the hosted end-state digests), but its intermediate saves were not compared.
