/* global browser */
import React from 'react';
import { render, act, waitFor, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CollectionListOptions } from '../app/CollectionListOptions';
import { Provider } from 'jotai';

describe('Collection List Options tests', () => {
  test('CollectionListOptions renders correctly', async () => {
    let container;
    
    await act(async () => {
      const result = render(
        <Provider>
          <CollectionListOptions />
        </Provider>,
      );
      container = result.container;
      
      // Allow all microtasks (Promise resolutions) to complete
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    
    expect(container).toMatchSnapshot();
  });

  test('uses the full-page toolbar button styles with a working sort dropdown in popup view', async () => {
    const { container } = render(
      <Provider>
        <CollectionListOptions addCollection={jest.fn()} />
      </Provider>,
    );

    await waitFor(() => {
      expect(container.querySelector('.collections-toolbar.fp-toolbar')).toBeInTheDocument();
      expect(container.querySelector('#toolbar-sort-select .toolbar-select__control')).toBeInTheDocument();
      expect(container.querySelector('#toolbar-sort-select .toolbar-select-single-value')).toBeInTheDocument();
      expect(container.querySelector('#toolbar-sort-direction')).toHaveClass('fp-toolbar-btn');
      expect(container.querySelector('#toolbar-open-new-window')).toHaveClass('fp-toolbar-btn');
      expect(container.querySelector('#toolbar-view-mode')).toHaveClass('fp-toolbar-btn');
      expect(container.querySelector('#toolbar-import')).toHaveClass('fp-toolbar-btn');
      expect(container.querySelector('.fp-toolbar-pill')).toBeInTheDocument();
      expect(container.querySelector('.fp-toolbar-color-picker')).toBeInTheDocument();
    });

    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /opened/i })).toHaveTextContent('Opened');
    expect(screen.getByRole('button', { name: /import collections from file/i })).toBeInTheDocument();

    fireEvent.mouseDown(container.querySelector('#toolbar-sort-select .toolbar-select__control'));

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Color')).toBeInTheDocument();
    });
  });

  test('loads recently closed items through browser.sessions for the restore toolbar button', async () => {
    browser.sessions.getRecentlyClosed.mockResolvedValue([
      {
        lastModified: 1710000000,
        tab: {
          sessionId: 'tab-session-1',
          title: 'Closed Tab',
          url: 'https://example.com',
        },
      },
    ]);

    const { container } = render(
      <Provider>
        <CollectionListOptions addCollection={jest.fn()} />
      </Provider>,
    );

    await waitFor(() => {
      expect(browser.sessions.getRecentlyClosed).toHaveBeenCalled();
      expect(container.querySelector('#toolbar-restore-session button')).not.toBeDisabled();
    });
  });

  test('keeps popup import limited to legacy txt files', async () => {
    const { container } = render(
      <Provider>
        <CollectionListOptions addCollection={jest.fn()} />
      </Provider>,
    );

    expect(container.querySelector('input[type="file"]')).toHaveAttribute('accept', '.txt');
  });
});
