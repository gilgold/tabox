import React from 'react';
import { render } from '@testing-library/react';
import AddNewTextbox from '../app/AddNewTextbox';
import { Provider } from 'jotai';

describe('Add new collection textbox tests', () => {
  test('Add new collection textbox renders correctly - sync disabled', () => {
    const { container } = render(
      <Provider>
        <AddNewTextbox />
      </Provider>,
    );
    expect(container).toMatchSnapshot();
  });
});