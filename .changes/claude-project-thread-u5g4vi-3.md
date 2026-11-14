---
app: patch
crate: patch
readmes: unchanged
---

## Player

- Fast food, restaurants and food halls now show only the diners who are actually inside, and a quiet one looks quiet. They used to draw a full room whenever they were open.

## Engine

- A meal venue's head count (fast food, restaurant, food hall; `Kind::is_meal_venue`) is the customers inside it (`customers_in`) while it stands, as party halls and cinemas already count their visitors. Commercial kinds no trip is sent to keep their full head count. Like the attendance venues (`Kind::counts_visitors`), a meal venue's head count is left out of the save, starts at 0 on a load or an undo, and is not added to the elevator waiting estimate, since its diners ride as real people. The conformance lock, frame days, port edits and fuzz goldens are re-pinned, and the Classic ransom scenario's first threat moved to hour 352.
