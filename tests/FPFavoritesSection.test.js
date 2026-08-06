/** @jest-environment jsdom */
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FPFavoritesSection from '../app/fullpage/FPFavoritesSection';
import { renderWithProviders } from './helpers/renderWithProviders';

let mockLatestCardFoldersByUid = {};
jest.mock('../app/fullpage/FPCollectionCard', () => function MockFPCollectionCard({ collection, folders }) {
    mockLatestCardFoldersByUid[collection.uid] = folders;
    return <div data-testid="fav-card">{collection.name}</div>;
});

const collections = [
    { uid: 'a', name: 'Alpha', isFavorite: true, favoriteOrder: 1 },
    { uid: 'b', name: 'Beta' },
    { uid: 'c', name: 'Gamma', isFavorite: true, favoriteOrder: 0 },
];

const noop = () => {};
const baseProps = {
    viewMode: 'grid',
    updateCollection: noop,
    removeCollection: noop,
    updateRemoteData: noop,
    addCollection: noop,
    onDataUpdate: noop,
    onSelect: noop,
};

describe('FPFavoritesSection', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders favorites sorted by favoriteOrder', () => {
        renderWithProviders(<FPFavoritesSection collections={collections} {...baseProps} />);
        const cards = screen.getAllByTestId('fav-card');
        expect(cards.map((el) => el.textContent)).toEqual(['Gamma', 'Alpha']);
    });

    it('shows the empty hint when nothing is favorited', () => {
        renderWithProviders(<FPFavoritesSection collections={[{ uid: 'b', name: 'Beta' }]} {...baseProps} />);
        expect(screen.getByText('Star a collection to pin it here')).toBeInTheDocument();
    });

    it('renders with drag disabled without crashing', () => {
        renderWithProviders(<FPFavoritesSection collections={collections} {...baseProps} disableDrag />);
        expect(screen.getAllByTestId('fav-card')).toHaveLength(2);
    });
});
