import React from 'react';
import renderer from 'react-test-renderer';
import CollectionList from '../app/CollectionList';
import { RecoilRoot } from 'recoil';

describe('Collection List tests', () => {
  test('Collection List renders correctly', () => {
    const component = renderer.create(
      <RecoilRoot>
        <CollectionList />
      </RecoilRoot>,
    );
    let tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });
});