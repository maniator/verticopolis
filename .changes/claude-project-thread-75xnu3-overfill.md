---
app: patch
crate: patch
readmes: unchanged
---
## Player
- In Modern, an office worker who gives up waiting for a ride home and walks back no longer squeezes a seventh worker into a full office, so a tower saved during the morning rush plays on exactly as it would have.
## Engine
- A commuting worker who reaches a full office heads out again instead of sitting down (`crowd::commuters::at_destination`), so an office's head count never passes its population. A turned-back worker could find their desk taken by a replacement the hourly pass booked while they were away; the office then held 7, and since the loader caps a head count at the population (#2240) a save reloaded mid-rush played differently from the unbroken game (#2267).
