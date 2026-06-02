---
date: 2026-03-10
topic: fullpage-drag-drop-snapback
---

# Fix Visual Snap-Back on Full Page Drag-Drop

## What We're Building

Eliminating the visual snap-back when drag-dropping collections in the full page view. Currently, when a collection is dropped at a new position, it briefly appears at its original grid slot before animating to the drop target. The fix ensures the collection immediately occupies its new position on drop.

## Why This Approach

Two complementary fixes:

1. **Optimistic synchronous state update** — restructure `handleDragEnd` so React state is updated with the reordered array *before* (or concurrently with) the async storage write. This eliminates the timing gap where the DOM shows the old order.

2. **Add `dropAnimation` to DragOverlay** — use dnd-kit's `defaultDropAnimation` so the overlay animates smoothly to the final slot instead of vanishing instantly. This polishes the transition and gives the state update time to land.

**Why not just dropAnimation alone:** It masks the gap but doesn't fix the root cause. A slow storage write could still produce a flash. Optimistic state eliminates the gap entirely.

**Why not just optimistic state alone:** It fixes correctness but the drop feels abrupt — the overlay just disappears. The drop animation adds visual continuity.

## Key Decisions

- **Optimistic-first pattern**: Call `updateRemoteData` synchronously before `await updateCollectionsOrder`, so the UI reflects the new order instantly. Storage write happens in the background.
- **Use `defaultDropAnimation`**: Standard dnd-kit pattern, already used in other parts of the codebase (`ExpandedCollectionData.js`).
- **Keep `activeCollection` clearing after state update**: Don't clear the overlay state until after `updateRemoteData` has been called.

## Open Questions

None — scope is tight and both fixes are well-understood patterns.

## Next Steps

-> `/workflows:plan` for implementation details
