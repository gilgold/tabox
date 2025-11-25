import React from 'react';
import { render } from '@testing-library/react';
import { CollectionListOptions } from '../app/CollectionListOptions';
import { Provider } from 'jotai';

describe('Collection List Options tests', () => {
  test('CollectionListOptions renders correctly', () => {
    const { container } = render(
      <Provider>
        <CollectionListOptions />
      </Provider>,
    );
    expect(container).toMatchSnapshot();
  });
});