/* global browser */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TabRow from '../app/TabRow';

describe('TabRow', () => {
    const tab = {
        uid: 'tab-1',
        title: 'OpenAI Docs',
        url: 'https://openai.com/docs',
        favIconUrl: 'https://openai.com/favicon.ico',
        groupId: -1,
    };

    const collection = {
        uid: 'collection-1',
        name: 'Docs',
        tabs: [tab],
        chromeGroups: [],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        browser.storage.local.get.mockResolvedValue({ chkOpenNewWindow: false });
        browser.tabs.create = jest.fn().mockResolvedValue({ id: 123 });
    });

    test('opens the tab when clicking the visible url', async () => {
        render(
            <TabRow
                tab={tab}
                collection={collection}
                updateCollection={jest.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'https://openai.com/docs' }));

        await waitFor(() => {
            expect(browser.tabs.create).toHaveBeenCalledWith({
                url: 'https://openai.com/docs',
                active: true,
            });
        });
    });
});
