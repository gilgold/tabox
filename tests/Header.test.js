import React from 'react';
import { render, act } from '@testing-library/react';
import Header from '../app/Header';
import { Provider } from 'jotai';

describe('Header -- Sync disabled', () => {
  test('Header renders correctly - sync disabled', async () => {
    let container;
    
    await act(async () => {
      const result = render(
        <Provider>
          <Header />
        </Provider>,
      );
      container = result.container;
      
      // Allow all microtasks (Promise resolutions) to complete
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    
    expect(container).toMatchSnapshot();
  });
});