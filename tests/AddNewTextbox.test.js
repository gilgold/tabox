import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AddNewTextbox from '../app/AddNewTextbox';
import { Provider, createStore } from 'jotai';
import { getAllWindowsTabsAndGroups, getCurrentTabsAndGroups } from '../app/utils';
import { premiumEntitlementState } from '../app/atoms/premiumState';
import { suggestCollectionName } from '../app/ai/tasks/suggestCollectionName';

jest.mock('../app/utils', () => ({
  ...jest.requireActual('../app/utils'),
  getCurrentTabsAndGroups: jest.fn(),
  getAllWindowsTabsAndGroups: jest.fn(),
}));

jest.mock('../app/toastHelpers', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}));

jest.mock('../app/ai/useTaboxAIEnabled', () => ({ useTaboxAIEnabled: () => true }));
jest.mock('../app/ai/tasks/suggestCollectionName', () => ({ suggestCollectionName: jest.fn() }));
jest.mock('../app/ai/tasks/suggestFolderName', () => ({ suggestFolderName: jest.fn() }));

const proStore = () => {
  const store = createStore();
  store.set(premiumEntitlementState, { entitled: true, refreshedAt: new Date().toISOString() });
  return store;
};

describe('Add new collection textbox tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    browser.windows.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    browser.tabs.query.mockResolvedValue([]);
    browser.runtime.sendMessage.mockResolvedValue({});
    getAllWindowsTabsAndGroups.mockResolvedValue({
      folder: { uid: 'folder-template', name: 'Project', color: '#6b7280', collapsed: true },
      collections: [{ uid: 'collection-1', name: 'Project - Window 1' }],
    });
    getCurrentTabsAndGroups.mockResolvedValue({ tabs: [{ title: 'OpenRouter docs', url: 'https://openrouter.ai' }] });
    suggestCollectionName.mockResolvedValue('AI Research');
  });

  test('suggests a current-window collection name from the add/search textbox', async () => {
    render(
      <Provider store={proStore()}>
        <AddNewTextbox />
      </Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /suggest name with ai/i }));

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('AI Research'));
    expect(getCurrentTabsAndGroups).toHaveBeenCalledWith('');
    expect(suggestCollectionName).toHaveBeenCalledWith(expect.objectContaining({ tabs: expect.any(Array) }));
  });

  test('Add new collection textbox renders correctly - sync disabled', async () => {
    const { container } = render(
      <Provider>
        <AddNewTextbox />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save all windows as folder' })).not.toBeDisabled();
    });

    expect(container).toMatchSnapshot();
  });

  test('uses the default folder color and hides folder color options when saving all windows as a folder', async () => {
    const addFolder = jest.fn().mockResolvedValue({ uid: 'folder-1' });
    const addCollection = jest.fn().mockResolvedValue(true);
    const onDataUpdate = jest.fn().mockResolvedValue(undefined);

    render(
      <Provider>
        <AddNewTextbox addFolder={addFolder} addCollection={addCollection} onDataUpdate={onDataUpdate} />
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save all windows as folder' })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save all windows as folder' }));

    expect(screen.queryByLabelText('Folder color options')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Choose .* folder color/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Folder' }));

    await waitFor(() => {
      expect(getAllWindowsTabsAndGroups).toHaveBeenCalledWith('Project');
    });

    expect(addFolder).toHaveBeenCalledWith('Project', '#6b7280', true);
    expect(addCollection).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'folder-1' }),
      true,
      true,
    );
  });
});
