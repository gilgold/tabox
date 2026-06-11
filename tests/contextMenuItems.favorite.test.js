import { createCollectionMenuItems } from '../app/utils/contextMenuItems';

describe('createCollectionMenuItems favorite entry', () => {
    it('shows "Add to Favorites" when not favorited', () => {
        const items = createCollectionMenuItems({ isFavorite: false, onToggleFavorite: jest.fn() });
        const favoriteItem = items.find((item) => item.id === 'favorite');
        expect(favoriteItem).toBeDefined();
        expect(favoriteItem.text).toBe('Add to Favorites');
        expect(favoriteItem.condition).toBe(true);
    });

    it('shows "Remove from Favorites" when favorited', () => {
        const items = createCollectionMenuItems({ isFavorite: true, onToggleFavorite: jest.fn() });
        const favoriteItem = items.find((item) => item.id === 'favorite');
        expect(favoriteItem.text).toBe('Remove from Favorites');
    });

    it('hides the entry when no handler is provided', () => {
        const items = createCollectionMenuItems({});
        const favoriteItem = items.find((item) => item.id === 'favorite');
        expect(favoriteItem.condition).toBe(false);
    });
});
