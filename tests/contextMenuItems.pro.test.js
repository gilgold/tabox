import { createCollectionMenuItems } from '../app/utils/contextMenuItems';

const handlers = { onShareLink: jest.fn() };

test('marks Share via Link with a Pro badge only for non-Pro users', () => {
    const freeItems = createCollectionMenuItems({ ...handlers, isPro: false });
    const proItems = createCollectionMenuItems({ ...handlers, isPro: true });

    expect(freeItems.find((item) => item.id === 'share-link')).toEqual(
        expect.objectContaining({ text: 'Share via Link', proBadge: true }),
    );
    expect(proItems.find((item) => item.id === 'share-link')).toEqual(
        expect.objectContaining({ text: 'Share via Link', proBadge: false }),
    );
});
