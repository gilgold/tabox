// e2e/support/dnd.mjs
// Manual pointer-driven drag for mid-drag assertions (indicators, hover
// highlights). ext.dragAndDrop() is atomic — press/assert/release needs raw
// mouse control. dnd-kit's sensors activate after the unified 5px of travel
// (app/utils/dndShared.js); the 12px diagonal move below clears it comfortably.

export async function startDrag(page, sourceLocator) {
  const box = await sourceLocator.boundingBox();
  if (!box) {
    throw new Error(`startDrag: source element has no bounding box (not visible): ${sourceLocator}`);
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Exceed the activation distance so the drag session starts.
  await page.mouse.move(startX + 12, startY + 12, { steps: 4 });
}

export async function dragOver(page, targetLocator, { steps = 10 } = {}) {
  const box = await targetLocator.boundingBox();
  if (!box) {
    throw new Error(`dragOver: target element has no bounding box (not visible): ${targetLocator}`);
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
}

export async function drop(page) {
  await page.mouse.up();
}
