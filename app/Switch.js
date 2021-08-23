import React, { useState, useCallback, useEffect } from 'react';
import './Switch.css';
import { browser } from '../static/index';
import ReactTooltip from 'react-tooltip';

const Switch = props => {
  const [isChecked, setIsChecked] = useState(false);
  useEffect(() => {
    ReactTooltip.rebuild();
    browser.storage.local.get(props.id).then((items) => {
        if (items[props.id]) {
            setIsChecked(items[props.id]);
        }
    });
  }, []);

  const setLocalStorage = (value) => {
    const localStorageObj = {};
    localStorageObj[props.id] = value;
    browser.storage.local.set(localStorageObj);
  }

  const toggle = useCallback((event) => {
    const target = event.target;
    setIsChecked(target.checked);
    setLocalStorage(target.checked);
  });

  const {id: _id, textOn, textOff, ...otherProps} = props;

  return <span {...otherProps} data-class="small-tooltip" data-multiline={true}>
                <input type="checkbox" checked={isChecked} onChange={toggle} id={_id} name={_id} className="switch-input" />
                <label htmlFor={_id} className="switch-label">
                        <span className="toggle--on">
                            {textOn}
                        </span>
                        <span className="toggle--off">
                            {textOff}
                        </span>
                </label>
            </span>;
};

export default Switch;