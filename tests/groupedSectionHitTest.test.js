/** @jest-environment jsdom */
import { resolveGroupedSectionTarget } from '../app/fullpage/groupedSectionHitTest';
import { collectionDropKinds, collectionDropSides } from '../app/utils/collectionSectionDragEngine';

const mockRect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});

// Builds <div data-grouped-section-body-parent-id> with optional
// [data-sortable-collection-id] cards, all with mocked rects.
const buildSection = (parentId, rect, cards = []) => {
    const body = document.createElement('div');
    body.setAttribute('data-grouped-section-body-parent-id', parentId);
    body.getBoundingClientRect = () => rect;
    cards.forEach(({ id, rect: cardRect }) => {
        const card = document.createElement('div');
        card.setAttribute('data-sortable-collection-id', id);
        card.getBoundingClientRect = () => cardRect;
        body.appendChild(card);
    });
    document.body.appendChild(body);
    return body;
};

describe('resolveGroupedSectionTarget', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('empty section returns sectionEmpty within the 18px hit slop', () => {
        buildSection('folder-1', mockRect(0, 100, 400, 80));

        expect(resolveGroupedSectionTarget({ point: { x: 200, y: 90 }, viewMode: 'list', activeId: 'col-x' }))
            .toEqual({ kind: collectionDropKinds.sectionEmpty, parentId: 'folder-1' });
    });

    test('empty root section maps __root__ to a null parentId', () => {
        buildSection('__root__', mockRect(0, 100, 400, 80));

        expect(resolveGroupedSectionTarget({ point: { x: 200, y: 140 }, viewMode: 'list', activeId: 'col-x' }))
            .toEqual({ kind: collectionDropKinds.sectionEmpty, parentId: null });
    });

    test('list mode: top band returns sectionStart, bottom band returns sectionEnd', () => {
        buildSection('folder-1', mockRect(0, 100, 400, 200), [
            { id: 'col-a', rect: mockRect(0, 110, 400, 56) },
            { id: 'col-b', rect: mockRect(0, 170, 400, 56) },
        ]);

        expect(resolveGroupedSectionTarget({ point: { x: 200, y: 110 }, viewMode: 'list', activeId: 'col-x' }))
            .toEqual({ kind: collectionDropKinds.sectionStart, parentId: 'folder-1' });

        expect(resolveGroupedSectionTarget({ point: { x: 200, y: 250 }, viewMode: 'list', activeId: 'col-x' }))
            .toEqual({ kind: collectionDropKinds.sectionEnd, parentId: 'folder-1' });
    });

    test('grid mode: returns the nearest non-active card with a side', () => {
        buildSection('folder-1', mockRect(0, 0, 600, 200), [
            { id: 'col-a', rect: mockRect(0, 20, 200, 150) },
            { id: 'col-b', rect: mockRect(220, 20, 200, 150) },
        ]);

        expect(resolveGroupedSectionTarget({ point: { x: 260, y: 95 }, viewMode: 'grid', activeId: 'col-x' }))
            .toEqual({
                kind: collectionDropKinds.collection,
                parentId: 'folder-1',
                collectionId: 'col-b',
                side: collectionDropSides.before,
            });
    });

    test('grid mode: skips the active card when finding the nearest target', () => {
        buildSection('folder-1', mockRect(0, 0, 600, 200), [
            { id: 'col-a', rect: mockRect(0, 20, 200, 150) },
            { id: 'col-b', rect: mockRect(220, 20, 200, 150) },
        ]);

        const target = resolveGroupedSectionTarget({ point: { x: 100, y: 95 }, viewMode: 'grid', activeId: 'col-a' });
        expect(target.collectionId).toBe('col-b');
    });

    test('returns null when the point is outside every section', () => {
        buildSection('folder-1', mockRect(0, 100, 400, 80));

        expect(resolveGroupedSectionTarget({ point: { x: 900, y: 900 }, viewMode: 'list', activeId: 'col-x' }))
            .toBeNull();
    });
});
