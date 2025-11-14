import React from 'react';
import renderer from 'react-test-renderer';
import { CollectionListOptions } from '../app/CollectionListOptions';
import { RecoilRoot } from 'recoil';

describe('Collection List Options tests', () => {
  test('CollectionListOptions renders correctly', () => {
    const component = renderer.create(
      <RecoilRoot>
        <CollectionListOptions />
      </RecoilRoot>,
    );
    let tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });
});