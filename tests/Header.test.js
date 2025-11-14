import React from 'react';
import renderer from 'react-test-renderer';
import Header from '../app/Header';
import { RecoilRoot } from 'recoil';

describe('Header -- Sync disabled', () => {
  test('Header renders correctly - sync disabled', () => {
    const component = renderer.create(
      <RecoilRoot>
        <Header />
      </RecoilRoot>,
    );
    let tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });
});