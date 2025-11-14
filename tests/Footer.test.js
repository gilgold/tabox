import React from 'react';
import renderer from 'react-test-renderer';
import { RecoilRoot } from 'recoil';
import Footer from '../app/Footer';

describe('Footer Tests', () => {
  test('Footer renders correctly', () => {
    const component = renderer.create(
      <RecoilRoot>
        <Footer />
      </RecoilRoot>,
    );
    let tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });
});