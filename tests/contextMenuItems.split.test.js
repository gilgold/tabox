import { createCollectionMenuItems } from '../app/utils/contextMenuItems';

const base = { onExport() {}, onUpdate() {}, onDelete() {}, onDuplicate() {}, onCopyUrls() {} };

test('shows [AI] Split Collection only when AI enabled and tabCount >= threshold', () => {
    const big = createCollectionMenuItems({ ...base, aiEnabled: true, tabCount: 40, onSplitCollection() {} });
    const item = big.find((i) => i.id === 'split-collection');
    expect(item).toBeDefined();
    expect(item.condition).toBe(true);

    const small = createCollectionMenuItems({ ...base, aiEnabled: true, tabCount: 10, onSplitCollection() {} });
    expect(small.find((i) => i.id === 'split-collection').condition).toBe(false);

    const noAi = createCollectionMenuItems({ ...base, aiEnabled: false, tabCount: 40, onSplitCollection() {} });
    expect(noAi.find((i) => i.id === 'split-collection').condition).toBe(false);
});
