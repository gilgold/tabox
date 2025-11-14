import React from 'react';
import renderer from 'react-test-renderer';
import AddNewTextbox from '../app/AddNewTextbox';
import { RecoilRoot } from 'recoil';

describe('Add new collection textbox tests', () => {
  test('Add new collection textbox renders correctly - sync disabled', () => {
    const component = renderer.create(
      <RecoilRoot>
        <AddNewTextbox />
      </RecoilRoot>,
    );
    let tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });
});