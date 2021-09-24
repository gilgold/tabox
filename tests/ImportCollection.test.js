import React from 'react';
import renderer from 'react-test-renderer';
import ImportCollection from '../app/ImportCollection';
import { RecoilRoot } from 'recoil';

describe('Import Collection section tests', () => {
  test('Import collection component renders correctly', () => {
    const component = renderer.create(
      <RecoilRoot>
        <ImportCollection />
      </RecoilRoot>,
    );
    let tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });
});