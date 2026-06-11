/** @jest-environment jsdom */
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FavoritesSection from '../app/FavoritesSection';
import { renderWithProviders } from './helpers/renderWithProviders';

jest.mock('../app/CollapsableSection', () => function MockCollapsableSection({ sectionTitle, count, children }) {
    return (
        <div data-testid="collapsable-section">
            <span>{`${sectionTitle} (${count})`}</span>
            {children}
        </div>
    );
});

jest.mock('../app/SortableCollectionItem', () => function MockSortableItem({ collection }) {
    return <div data-testid="fav-item">{collection.name}</div>;
});

jest.mock('../app/SortableCollectionTile', () => function MockSortableTile({ collection }) {
    return <div data-testid="fav-tile">{collection.name}</div>;
});

jest.mock('../app/CollectionTile', () => function MockCollectionTile() {
    return null;
});

jest.mock('../static/globals', () => ({
    browser: { storage: { local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) } } },
}));

const collections = [
    { uid: 'a', name: 'Alpha', isFavorite: true, favoriteOrder: 1 },
    { uid: 'b', name: 'Beta', isFavorite: false },
    { uid: 'c', name: 'Gamma', isFavorite: true, favoriteOrder: 0 },
];

const noop = () => {};
const baseProps = {
    updateCollection: noop,
    removeCollection: noop,
    updateRemoteData: noop,
    addCollection: noop,
    onDataUpdate: noop,
    onSelect: noop,
};

describe('FavoritesSection', () => {
    it('renders only favorited collections sorted by favoriteOrder (list view)', () => {
        renderWithProviders(<FavoritesSection collections={collections} viewMode="list" {...baseProps} />);
        const items = screen.getAllByTestId('fav-item');
        expect(items.map((el) => el.textContent)).toEqual(['Gamma', 'Alpha']);
        expect(screen.getByText('Favorites (2)')).toBeInTheDocument();
    });

    it('renders tiles in grid view', () => {
        renderWithProviders(<FavoritesSection collections={collections} viewMode="grid" {...baseProps} />);
        expect(screen.getAllByTestId('fav-tile')).toHaveLength(2);
    });

    it('shows the empty hint when nothing is favorited', () => {
        renderWithProviders(<FavoritesSection collections={[{ uid: 'b', name: 'Beta' }]} viewMode="list" {...baseProps} />);
        expect(screen.getByText('Star a collection to pin it here')).toBeInTheDocument();
        expect(screen.getByText('Favorites (0)')).toBeInTheDocument();
    });
});
