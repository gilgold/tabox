import React from 'react';
import { render } from '@testing-library/react';
import Header from '../app/Header';
import { Provider } from 'jotai';

describe('Header -- Sync disabled', () => {
  test('Header renders correctly - sync disabled', () => {
    const { container } = render(
      <Provider>
        <Header />
      </Provider>,
    );
    expect(container).toMatchSnapshot();
  });
});