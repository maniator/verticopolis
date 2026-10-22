# #874 restore-point PC run notes, 2026-10-21

The owner's desktop (AMD Ryzen 5 5600X, NVIDIA RTX 3060, Windows 11), run by
the PC thread from the run file `pc-run-874-restore-points.md`. Nothing was
committed or pushed from the PC; `report.md` and `results.json` are the files
the run wrote, copied here unchanged.

| | |
| --- | --- |
| commit | `4fa8072408df3c6960f8dcfa5034f4a3e5f92cbe` (main, the #1101 merge) |
| checkout | a fresh clone under `%USERPROFILE%\projects`, `core.autocrlf=false`, porcelain empty |
| engine sources hash | `28314c073c99bafa0410811b891a53a414f97d13eadb1583d8dea9d4cd632f95` (recorded only; the run file names no expected hash) |
| command | `npm.cmd run perf:restore -- --reps 10`, `PW_CHROMIUM_PATH` set to full Chromium 149.0.7827.55 |
| exit code | 0, report "Problems: None" |
| start / end (UTC) | 03:17:13 / 03:59:09 (42 min) |
| power plan | High performance (`8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c`) |
| idle CPU % (5 samples just before) | 8, 26, 45, 3, 17 |

- The owner's rapid-edit check passes: every `edits` row (small, medium and
  large, at 1x and 4x) shows 400 commands, 400 merges, 400 hosted saves (one
  per command, the undo capture's own save) and 0 extra saves. Extra saves
  are 0 on all 24 rows.
- The idle CPU before the run was noisy: build checks had just finished and
  a browser had just closed. The check counts saves, so the noise does not
  touch it; the timings are context only.
- Machine state: other Chrome windows closed, no local model loaded (the
  ollama service was running with nothing loaded), the ChatGPT app closed.
  Deviation: the NVIDIA Overlay processes persist after a stop, as in earlier
  runs.
