import React, { useState, useCallback, useEffect } from 'react';
import './Switch.css';
import { browser } from '../static/globals';

const Switch = props => {
  const { id: _id, textOn, textOff, disabled, ...otherProps } = props;
  const [isChecked, setIsChecked] = useState(false);
  useEffect(() => {
    // Load initial value from storage
    browser.storage.local.get(_id).then((items) => {
        if (items[_id]) {
            setIsChecked(items[_id]);
        }
    });
  }, [_id]); // Only run when _id changes

  useEffect(() => {
    setLocalStorage(disabled ? false : isChecked);
  } , [disabled, isChecked]);

  const setLocalStorage = (value) => {
    const localStorageObj = {};
    localStorageObj[_id] = value;
    browser.storage.local.set(localStorageObj);
  }

  const toggle = useCallback((event) => {
    const target = event.target;
    setIsChecked(target.checked);
    setLocalStorage(target.checked);
  });

  return <span {...otherProps} data-tooltip-class-name="small-tooltip">
                <input type="checkbox" disabled={disabled} checked={disabled ? false : isChecked} onChange={toggle} id={_id} name={_id} className="switch-input" />
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