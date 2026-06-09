// e2e/support/dnd.mjs
// Manual pointer-driven drag for mid-drag assertions (indicators, hover
// highlights). ext.dragAndDrop() is atomic — press/assert/release needs raw
// mouse control. dnd-kit's PointerSensor activates after 5px of travel.

export async function startDrag(page, sourceLocator) {
  const box = await sourceLocator.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Exceed the activation distance so the drag session starts.
  await page.mouse.move(startX + 12, startY + 12, { steps: 4 });
  return { startX, startY };
}

export async function dragOver(page, targetLocator, { steps = 10 } = {}) {
  const box = await targetLocator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
}

export async function drop(page) {
  await page.mouse.up();
}
