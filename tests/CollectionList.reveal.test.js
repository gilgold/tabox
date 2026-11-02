import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Provider, createStore } from 'jotai';
import CollectionList from '../app/CollectionList';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en.json';
TimeAgo.addDefaultLocale(en);
import { highlightedCollectionUidState } from '../app/atoms/animationsState';

const saved = { uid: 'saved', name: 'Saved collection', parentId: 'project', tabs: [], chromeGroups: [], lastUpdated: Date.now() };
const folder = { uid: 'project', name: 'Project', collapsed: true, color: 'blue' };

beforeEach(() => {
    browser.storage.local.get.mockImplementation(async () => ({ foldersCollapsed: true }));
    browser.runtime.sendMessage.mockResolvedValue({});
    HTMLElement.prototype.scrollIntoView = jest.fn();
});

test.each(['list', 'grid'])('reveals a saved collection inside a collapsed folder and section in %s view', async viewMode => {
    const store = createStore();
    const onFolderStateChange = jest.fn();
    const props = { collections: [saved], folders: [folder], onFolderStateChange, viewMode };
    const { container, rerender } = render(<Provider store={store}><CollectionList {...props} /></Provider>);
    await waitFor(() => expect(screen.queryByText('Project')).not.toBeInTheDocument());
    act(() => store.set(highlightedCollectionUidState, saved.uid));
    await waitFor(() => expect(onFolderStateChange).toHaveBeenCalledWith(expect.objectContaining({ uid: 'project', collapsed: false })));
    rerender(<Provider store={store}><CollectionList {...props} folders={[{ ...folder, collapsed: false }]} /></Provider>);
    const selector = viewMode === 'list' ? '.collection-item-highlight' : '.new-tile-highlight';
    await waitFor(() => expect(container.querySelector(selector)).toBeInTheDocument());
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(HTMLElement.prototype.scrollIntoView.mock.instances.at(-1)).toBe(container.querySelector(selector));
    expect(browser.storage.local.set).toHaveBeenCalledWith({ foldersCollapsed: false });
});

test('does not expand folders when no saved collection is highlighted', async () => {
    const onFolderStateChange = jest.fn();
    render(<Provider><CollectionList collections={[saved]} folders={[folder]} onFolderStateChange={onFolderStateChange} /></Provider>);
    await waitFor(() => expect(screen.getByText('Folders')).toBeInTheDocument());
    expect(onFolderStateChange).not.toHaveBeenCalled();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
});
