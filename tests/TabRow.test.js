/* global browser */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import TabRow from '../app/TabRow';
import SortableTabRow from '../app/SortableTabRow';

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

    test('opens a context menu on right-click of the tab row', () => {
        const { container } = render(
            <TabRow
                tab={tab}
                collection={collection}
                updateCollection={jest.fn()}
            />,
        );

        expect(screen.queryByText('Copy URL')).not.toBeInTheDocument();

        fireEvent.contextMenu(container.querySelector('.single-tab-row'), { clientX: 40, clientY: 50 });

        expect(screen.getByText('Copy URL')).toBeInTheDocument();
        expect(screen.getByText('Delete tab')).toBeInTheDocument();
    });

    test('opens a context menu on right-click when rendered via SortableTabRow inside a DndContext', () => {
        const { container } = render(
            <DndContext>
                <SortableContext items={[tab.uid]}>
                    <SortableTabRow
                        tab={tab}
                        collection={collection}
                        updateCollection={jest.fn()}
                        disableDrag={false}
                    />
                </SortableContext>
            </DndContext>,
        );

        expect(screen.queryByText('Copy URL')).not.toBeInTheDocument();

        fireEvent.contextMenu(container.querySelector('.single-tab-row'), { clientX: 40, clientY: 50 });

        expect(screen.getByText('Copy URL')).toBeInTheDocument();
    });

    test('renders the context menu above the collection detail panel (z-index > 60000)', () => {
        const { container } = render(
            <TabRow
                tab={tab}
                collection={collection}
                updateCollection={jest.fn()}
            />,
        );

        fireEvent.contextMenu(container.querySelector('.single-tab-row'), { clientX: 40, clientY: 50 });

        const menu = screen.getByText('Copy URL').closest('.fp-tab-ctx-menu');
        expect(menu).toBeInTheDocument();
        // .collection-detail-panel sits at z-index 60000; the menu must stack above it.
        expect(Number(menu.style.zIndex)).toBeGreaterThan(60000);
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
