---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: office workers who go out for dinner or a movie after office hours now go home from the restaurant or cinema. Before, they rode back to the office first, and a few were still leaving after midnight (#2481).

## Engine
- A Modern office worker whose outing (a meal or a cinema visit) ends outside office hours leaves the tower from the venue (`workplace::off_work_after_outing`): the office's desk and head count drop by one and its `out_for_meal` comes back down, and the return leg goes to the ground lobby. During office hours, and in Classic, the outing still returns to the office (#2481).
