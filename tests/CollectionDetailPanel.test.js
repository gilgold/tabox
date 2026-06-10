import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider } from 'jotai';
import CollectionDetailPanel from '../app/CollectionDetailPanel';
import { useCollectionOperations } from '../app/useCollectionOperations';

jest.mock('javascript-time-ago', () => jest.fn().mockImplementation(() => ({
    format: jest.fn(() => '4 hours ago'),
})));

jest.mock('../app/useCollectionOperations', () => ({
    useCollectionOperations: jest.fn(() => ({
        _handleDelete: jest.fn(),
        _handleDuplicate: jest.fn(),
        _exportCollectionToFile: jest.fn(),
        _handleUpdate: jest.fn(),
        _handleOpenTabs: jest.fn(),
        _handleFocusWindow: jest.fn(),
        _handleStopTracking: jest.fn(),
    })),
}));

jest.mock('../app/ColorPicker', () => function MockColorPicker() {
    return <div data-testid="color-picker" />;
});

jest.mock('../app/ExpandedCollectionData', () => function MockExpandedCollectionData() {
    return <div data-testid="expanded-collection-data" />;
});

const baseCollection = {
    uid: 'collection-1',
    name: 'incognito',
    tabs: [{ url: 'https://example.com' }],
    chromeGroups: [],
    lastUpdated: Date.now(),
    savedFromIncognito: true,
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const renderPanel = async (props = {}) => {
    let result;
    await act(async () => {
        result = render(
            <Provider>
                <CollectionDetailPanel
                    collection={baseCollection}
                    isOpen={true}
                    onClose={jest.fn()}
                    updateCollection={jest.fn()}
                    removeCollection={jest.fn()}
                    updateRemoteData={jest.fn()}
                    addCollection={jest.fn()}
                    onDataUpdate={jest.fn()}
                    renderInline={true}
                    {...props}
                />
            </Provider>,
        );
    });
    return result;
};

describe('CollectionDetailPanel title editing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.get.mockResolvedValue({});
    });

    test('opens a confirmation modal before deleting the collection', async () => {
        const handleDelete = jest.fn();
        useCollectionOperations.mockReturnValue({
            _handleDelete: handleDelete,
            _handleDuplicate: jest.fn(),
            _exportCollectionToFile: jest.fn(),
            _handleUpdate: jest.fn(),
            _handleOpenTabs: jest.fn(),
            _handleFocusWindow: jest.fn(),
            _handleStopTracking: jest.fn(),
        });

        await renderPanel();

        const deleteButton = document.querySelector('.panel-action-btn.danger');
        fireEvent.click(deleteButton);

        expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete Collection' })).toBeInTheDocument();
        expect(handleDelete).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        await waitFor(() => {
            expect(screen.queryByText('Delete Collection')).not.toBeInTheDocument();
        });
        expect(handleDelete).not.toHaveBeenCalled();
    });

    test('deletes the collection after confirmation and closes the panel', async () => {
        jest.useFakeTimers();
        const handleDelete = jest.fn().mockResolvedValue(undefined);
        const onClose = jest.fn();

        useCollectionOperations.mockReturnValue({
            _handleDelete: handleDelete,
            _handleDuplicate: jest.fn(),
            _exportCollectionToFile: jest.fn(),
            _handleUpdate: jest.fn(),
            _handleOpenTabs: jest.fn(),
            _handleFocusWindow: jest.fn(),
            _handleStopTracking: jest.fn(),
        });

        await renderPanel({ onClose });

        fireEvent.click(document.querySelector('.panel-action-btn.danger'));
        fireEvent.click(screen.getByRole('button', { name: 'Delete Collection' }));

        await waitFor(() => {
            expect(handleDelete).toHaveBeenCalledTimes(1);
        });

        await waitFor(() => {
            expect(screen.queryByText('Delete Collection')).not.toBeInTheDocument();
        });

        act(() => {
            jest.advanceTimersByTime(300);
        });

        expect(onClose).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    test('renders the edit button before the collection title and lets the edit button toggle edit mode', async () => {
        const { container } = await renderPanel();

        const titleRow = container.querySelector('.panel-title-row');
        const titleSlot = container.querySelector('.panel-title-slot');
        const editButton = container.querySelector('.panel-edit-btn');

        expect(titleRow.firstElementChild).toBe(editButton);
        expect(titleRow.children[1]).toBe(titleSlot);
        expect(titleSlot.querySelector('.panel-title')).toHaveTextContent('incognito');

        fireEvent.click(editButton);

        const editWrapper = container.querySelector('.panel-title-edit');
        const input = container.querySelector('.panel-title-input');

        expect(editWrapper).toBeInTheDocument();
        expect(editWrapper).toHaveClass('panel-title-edit-active');
        expect(input).toBeInTheDocument();
        expect(input).toHaveValue('incognito');
        expect(input).toHaveClass('panel-title-input');

        fireEvent.mouseDown(editButton);
        fireEvent.click(editButton);
        await waitFor(() => {
            expect(container.querySelector('.panel-title-edit')).not.toBeInTheDocument();
        });
        expect(titleSlot.querySelector('.panel-title')).toHaveTextContent('incognito');
    });

    test('keeps edit mode open while typing and saves on blur', async () => {
        const updateCollection = jest.fn();
        const { container } = await renderPanel({ updateCollection });

        const editButton = container.querySelector('.panel-edit-btn');
        fireEvent.click(editButton);

        const input = container.querySelector('.panel-title-input');
        fireEvent.change(input, { target: { value: 'incognito tabs' } });

        expect(container.querySelector('.panel-title-edit')).toBeInTheDocument();
        expect(updateCollection).not.toHaveBeenCalled();

        fireEvent.blur(input);
        await act(async () => {
            await flushPromises();
        });

        expect(updateCollection).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'incognito tabs' }),
            true,
        );
        await waitFor(() => {
            expect(container.querySelector('.panel-title-edit')).not.toBeInTheDocument();
        });
        expect(container.querySelector('.panel-title')).toHaveTextContent('incognito tabs');
    });

    test('clicking the edit button while focused exits edit mode instead of reopening it', async () => {
        const updateCollection = jest.fn();
        const { container } = await renderPanel({ updateCollection });

        const editButton = container.querySelector('.panel-edit-btn');
        fireEvent.click(editButton);

        const input = container.querySelector('.panel-title-input');
        fireEvent.change(input, { target: { value: 'incognito tabs' } });

        fireEvent.mouseDown(editButton);
        fireEvent.click(editButton);
        await act(async () => {
            await flushPromises();
        });

        expect(updateCollection).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'incognito tabs' }),
            true,
        );
        await waitFor(() => {
            expect(container.querySelector('.panel-title-edit')).not.toBeInTheDocument();
        });
        expect(container.querySelector('.panel-title')).toHaveTextContent('incognito tabs');
    });
});

describe('CollectionDetailPanel interaction with portaled tab menus and modals', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.get.mockResolvedValue({});
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        document.querySelectorAll('.fp-tab-ctx-menu, .move-modal-overlay, .outside-area').forEach((el) => el.remove());
    });

    const appendPortaledElement = (className) => {
        const wrapper = document.createElement('div');
        wrapper.className = className;
        const button = document.createElement('button');
        wrapper.appendChild(button);
        document.body.appendChild(wrapper);
        return button;
    };

    test('closes the panel on a plain outside mousedown', async () => {
        const onClose = jest.fn();
        await renderPanel({ onClose });

        const outsideButton = appendPortaledElement('outside-area');
        fireEvent.mouseDown(outsideButton);
        act(() => {
            jest.advanceTimersByTime(300);
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('keeps the panel open when clicking inside the tab context menu', async () => {
        const onClose = jest.fn();
        await renderPanel({ onClose });

        const menuButton = appendPortaledElement('fp-tab-ctx-menu');
        fireEvent.mouseDown(menuButton);
        act(() => {
            jest.advanceTimersByTime(300);
        });

        expect(onClose).not.toHaveBeenCalled();
    });

    test('keeps the panel open when interacting with the move-to-collection modal', async () => {
        const onClose = jest.fn();
        await renderPanel({ onClose });

        const modalButton = appendPortaledElement('move-modal-overlay');
        fireEvent.mouseDown(modalButton);
        act(() => {
            jest.advanceTimersByTime(300);
        });

        expect(onClose).not.toHaveBeenCalled();
    });

    test('Escape closes only the move modal, not the panel, while the modal is open', async () => {
        const onClose = jest.fn();
        await renderPanel({ onClose });

        appendPortaledElement('move-modal-overlay');
        fireEvent.keyDown(document, { key: 'Escape' });
        act(() => {
            jest.advanceTimersByTime(300);
        });

        expect(onClose).not.toHaveBeenCalled();
    });
});
