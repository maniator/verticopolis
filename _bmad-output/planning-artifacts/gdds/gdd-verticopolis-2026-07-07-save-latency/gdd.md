---
title: Save Latency Mitigation
game_type: simulation
platforms: browser
created: 2026-07-07
updated: 2026-07-07
---

# Verticopolis Save Latency Mitigation - Game Design Document

**Author:** BMad  
**Game Type:** Simulation  
**Target Platform(s):** Browser

---

## Executive Summary

### Core Concept

Large towers must autosave without breaking the player's flow. Benchmarks on a 12,975-unit save-shaped payload show synchronous localStorage compression is the main latency risk: JSON stringify averaged 9.42 ms, while synchronous DEFLATE over the JSON bytes averaged 69.78 ms before base64. Export already uses asynchronous native compression, so the player-facing gap is the recurring autosave path.

### Target Audience

Players building late-game Verticopolis towers with thousands of units, especially on machines where a main-thread save pause can be visible.

### Unique Selling Points (USPs)

- Big towers keep feeling alive while autosave runs.
- Crash recovery and update reloads still get a synchronous flush when they need one.
- Save files stay compatible with the existing compressed JSON format.

---

## Goals and Context

### Project Goals

- Reduce autosave hitch risk without changing tower simulation rules.
- Preserve existing localStorage and `.vctower` compatibility.
- Keep emergency reload paths safe from async write interruption.

### Background and Rationale

The benchmark party agreed the first fix should target compression scheduling, not a binary save rewrite. Binary encoding reduced compressed size from 244 KB to 197 KB and sync compression time from about 70 ms to about 30 ms in the synthetic payload, but it adds codec and migration risk. Native `CompressionStream` over JSON averaged 26.92 ms and keeps the current schema.

---

## Core Gameplay

### Game Pillars

- **Flow stays intact:** building, scrolling, and watching the tower should not pause for routine autosaves.
- **Player trust:** saves remain reliable, readable, and recoverable.
- **Late-game scale:** large towers should not punish players with visible save stalls.

### Core Gameplay Loop

The player builds, observes tenant behavior, reacts to problems, and relies on periodic autosave as invisible protection. Autosave must not become an interruption in that loop.

### Win/Loss Conditions

No new win or loss conditions. The success condition for this design is experiential: a large-tower autosave no longer performs synchronous compression on the main thread when asynchronous browser compression is available.

---

## Game Mechanics

### Primary Mechanics

- Autosave runs in the background using the existing compressed JSON save format.
- If multiple autosaves are requested while one is running, the newest tower state wins.
- Manual, update, and crash-recovery saves keep a synchronous path when immediate durability matters.

### Controls and Input

No control changes. Save buttons and autosave behavior stay in the same UI locations.

---

## Simulation Specific Elements

### Core Simulation Systems

The simulation is unchanged. Save work reads serialized state and writes persistence outside `src/engine/`.

### Management Mechanics

Autosave remains automatic protection. Manual saves still provide explicit player control.

### Building and Construction

No construction rules change.

### Economic and Resource Loops

No economy rules change.

### Progression and Unlocks

No progression rules change.

### Sandbox vs. Scenario

Applies to all tower play, regardless of rule-set.

---

## Progression and Balance

### Player Progression

Late-game towers benefit most because save payloads grow with unit count.

### Difficulty Curve

No difficulty changes.

### Economy and Resources

No economy changes. Browser storage quota pressure remains mitigated through compression.

---

## Level Design Framework

### Level Types

Applies to the single tower grid across all floors.

### Level Progression

No level progression changes.

---

## Art and Audio Direction

### Art Style

No art changes.

### Audio and Music

No audio changes.

---

## Technical Specifications

### Performance Requirements

- Routine autosave should avoid synchronous DEFLATE on browsers with `CompressionStream("deflate-raw")`.
- Synchronous save remains available for reload/update/crash-recovery paths.
- Save format remains `VCZ1:` plus base64 deflated JSON for localStorage.

### Platform-Specific Details

Requires the existing browser native compression support for the async path. If unsupported, fall back to the current synchronous path.

### Asset Requirements

No asset changes.

---

## Development Epics

### Epic Structure

| Epic | Goal | Summary |
| --- | --- | --- |
| Save latency mitigation | Make autosave less likely to hitch large towers | Add async local save support, route the periodic autosave through it, keep critical flushes synchronous, and cover compatibility in tests. |

---

## Success Metrics

### Technical Metrics

- Existing storage tests pass.
- Autosave can complete through the async compression path and still load through the existing decoder.
- Concurrent autosave requests coalesce so the latest state is persisted.

### Gameplay Metrics

- No visible UI or input behavior changes except reduced large-tower autosave pauses.

---

## Out of Scope

- Binary save format migration.
- Save workers.
- New UI save progress indicators.
- Changing `.vctower` container format.

---

## Assumptions and Dependencies

- Benchmark figures came from a Node runner and are directional, not a browser-device guarantee.
- Native browser compression remains available on supported browsers already accepted by the export path.
