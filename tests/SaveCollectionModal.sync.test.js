/** @jest-environment jsdom */
// The full-page Save dialog saves with skipStateUpdate, which makes App's
// addCollection skip its own Drive sync — so the dialog must push to Drive
// itself (except into a shared folder, which syncs through the Worker).
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Modal from 'react-modal';
import SaveCollectionModal from '../app/fullpage/SaveCollectionModal';

Modal.setAppElement(document.createElement('div'));

const renderModal = (props = {}) => {
    const addCollection = jest.fn(async () => true);
    render(
        <SaveCollectionModal
            isOpen
            onClose={jest.fn()}
            folders={[]}
            addCollection={addCollection}
            addFolder={jest.fn()}
            onDataUpdate={jest.fn()}
            onSaved={jest.fn()}
            {...props}
        />,
    );
    return { addCollection };
};

describe('SaveCollectionModal Drive sync', () => {
    beforeEach(() => {
        browser.runtime.sendMessage.mockClear();
        browser.runtime.sendMessage.mockResolvedValue(true);
        browser.storage.local.get.mockResolvedValue({});
        browser.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.example/', title: 'A' }]);
    });

    test('pushes the new collection to Drive after saving', async () => {
        const { addCollection } = renderModal();
        fireEvent.change(await screen.findByPlaceholderText('Enter a name for your collection...'), { target: { value: 'Reading list' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Collection' }));

        await waitFor(() => expect(addCollection).toHaveBeenCalled());
        await waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'updateRemote' }));
    });
});
