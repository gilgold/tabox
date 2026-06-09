import { findSidebarDropTarget } from '../app/fullpage/sidebarDropTargets';

const mockRect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height,
});

describe('findSidebarDropTarget', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('returns the folder uid whose rect contains the point', () => {
        document.body.innerHTML = `
            <div data-sidebar-folder-uid="folder-1"></div>
            <div data-sidebar-folder-uid="folder-2"></div>
            <div data-sidebar-no-folder="true"></div>
        `;
        const [f1, f2, root] = document.body.children;
        f1.getBoundingClientRect = () => mockRect(0, 0, 200, 40);
        f2.getBoundingClientRect = () => mockRect(0, 40, 200, 40);
        root.getBoundingClientRect = () => mockRect(0, 80, 200, 40);

        expect(findSidebarDropTarget(100, 60)).toBe('folder-2');
    });

    test('returns "no-folder" when the point is over the root-level item', () => {
        document.body.innerHTML = '<div data-sidebar-no-folder="true"></div>';
        document.body.firstElementChild.getBoundingClientRect = () => mockRect(0, 0, 200, 40);

        expect(findSidebarDropTarget(10, 10)).toBe('no-folder');
    });

    test('returns null when the point is outside every sidebar target', () => {
        document.body.innerHTML = '<div data-sidebar-folder-uid="folder-1"></div>';
        document.body.firstElementChild.getBoundingClientRect = () => mockRect(0, 0, 200, 40);

        expect(findSidebarDropTarget(500, 500)).toBeNull();
    });
});
