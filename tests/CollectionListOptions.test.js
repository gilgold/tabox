import React from 'react';
import { render, act } from '@testing-library/react';
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
});