import React, { useState, useCallback, useEffect } from 'react';
import './Switch.css';
import { browser } from '../static/index';
import { propTypes } from 'react-time-ago';

const Switch = props => {
  const [isChecked, setIsChecked] = useState(false);
  useEffect(() => {
    browser.storage.local.get(props.id).then((items) => {
        if (items[props.id]) {
            setIsChecked(items[props.id]);
        }
    });
  }, []);

  const toggle = useCallback((event) => {
    const target = event.target;
    setIsChecked(target.checked);
    const localStorageObj = {};
    localStorageObj[props.id] = target.checked;
    browser.storage.local.set(localStorageObj);
  });

  const {id: _id, textOn, textOff, ...otherProps} = props;

  return <span {...otherProps}>
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