import React from 'react';
import { render } from '@testing-library/react';
import CollectionList from '../app/CollectionList';
import { Provider } from 'jotai';

describe('Collection List tests', () => {
  test('Collection List renders correctly', () => {
    const { container } = render(
      <Provider>
        <CollectionList />
      </Provider>,
    );
    expect(container).toMatchSnapshot();
  });
});