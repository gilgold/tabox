import React from 'react';
import { render } from '@testing-library/react';
import { Provider } from 'jotai';
import Footer from '../app/Footer';

describe('Footer Tests', () => {
  test('Footer renders correctly', () => {
    const { container } = render(
      <Provider>
        <Footer />
      </Provider>,
    );
    expect(container).toMatchSnapshot();
  });
});