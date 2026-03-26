/* global browser */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
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
