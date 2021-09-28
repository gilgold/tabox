import React from 'react';
import { useSetRecoilState } from 'recoil';

import { searchState } from './atoms/globalAppSettingsState';

import './CollectionSearch.css';

export function CollectionSearch() {
    const setSearch = useSetRecoilState(searchState);

    return (
      <div className="search-group">
        <input
          type="text"
          placeholder=" "
          name="search"
          id="search"
          onChange={e => setSearch(e.target.value)}
        />
        <span className="bar"></span>
        <label className="textbox_label"><img className='search-icon' src='images/magnifying-glass.png' alt='' /> Search...</label>
      </div>
    );
}
