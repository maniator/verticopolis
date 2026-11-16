---
app: patch
crate: patch
readmes: unchanged
---
## Player
- An elevator schedule's Auto-tune now learns from quiet days too: a weekend with no riders counts as measured after six hours instead of never.

## Engine
- Each elevator demand ring keeps the hours it has sampled, so a measured zero counts toward the Auto-tune warm-up gate, and `elevatorTelemetry()` carries `weekdaySampled` and `weekendSampled` (#474).
