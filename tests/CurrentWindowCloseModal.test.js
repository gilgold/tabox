import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CurrentWindowCloseModal from '../app/fullpage/CurrentWindowCloseModal';

describe('CurrentWindowCloseModal', () => {
    const windowSnapshot = {
        uid: 'current-window-8',
        windowId: 8,
        name: 'Current Window',
        tabs: [{ id: 801, uid: 'tab-801', title: 'Example', url: 'https://example.com', groupId: -1 }],
        chromeGroups: [],
        window: { id: 8 },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        browser.windows.remove.mockResolvedValue(undefined);
    });

    test('saves the window as a collection before closing when requested', async () => {
        const addCollection = jest.fn().mockResolvedValue(true);
        const onWindowClosed = jest.fn().mockResolvedValue(undefined);

        render(
            <CurrentWindowCloseModal
                isOpen={true}
                onClose={jest.fn()}
                windowSnapshot={windowSnapshot}
                folders={[]}
                addCollection={addCollection}
                onDataUpdate={jest.fn()}
                onSaved={jest.fn()}
                onWindowClosed={onWindowClosed}
            />,
        );

        fireEvent.click(screen.getByText('Save & Close'));

        await waitFor(() => {
            expect(addCollection).toHaveBeenCalledTimes(1);
        });
        expect(browser.windows.remove).toHaveBeenCalledWith(8);
        expect(onWindowClosed).toHaveBeenCalledWith(8);
    });

    test('can close without saving', async () => {
        const addCollection = jest.fn().mockResolvedValue(true);

        render(
            <CurrentWindowCloseModal
                isOpen={true}
                onClose={jest.fn()}
                windowSnapshot={windowSnapshot}
                folders={[]}
                addCollection={addCollection}
                onDataUpdate={jest.fn()}
                onSaved={jest.fn()}
                onWindowClosed={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByText('Close Without Saving'));

        await waitFor(() => {
            expect(browser.windows.remove).toHaveBeenCalledWith(8);
        });
        expect(addCollection).not.toHaveBeenCalled();
    });
});
