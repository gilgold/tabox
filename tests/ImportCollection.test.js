import React from 'react';
import { render } from '@testing-library/react';
import ImportCollection from '../app/ImportCollection';
import { Provider } from 'jotai';

describe('Import Collection section tests', () => {
  test('Import collection component renders correctly', () => {
    const { container } = render(
      <Provider>
        <ImportCollection />
      </Provider>,
    );
    expect(container).toMatchSnapshot();
  });
});