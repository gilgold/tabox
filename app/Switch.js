import React, { useState, useCallback, useEffect } from 'react';
import './Switch.css';
import { browser } from '../static/index';

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

  return <span>
                <input type="checkbox" checked={isChecked} onChange={toggle} id={props.id} name={props.id} className="switch-input" />
                <label htmlFor={props.id} className="switch-label">
                        <span className="toggle--on">
                            {props.textOn}
                        </span>
                        <span className="toggle--off">
                            {props.textOff}
                        </span>
                </label>
            </span>;
};

export default Switch;