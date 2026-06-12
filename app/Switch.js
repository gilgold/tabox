import React, { useState, useCallback, useEffect, useRef } from 'react';
import './Switch.css';
import { browser } from '../static/globals';

const USER_TOGGLE_ANIMATION_MS = 500;

const Switch = props => {
  const { id: _id, textOn, textOff, disabled, className, animateOnUserToggleOnly = false, onBeforeChange, ...otherProps } = props;
  const [isChecked, setIsChecked] = useState(false);
  const [toggleAnimation, setToggleAnimation] = useState(null);
  const loaded = useRef(false);
  const animationTimeoutRef = useRef(null);

  const clearAnimationTimeout = useCallback(() => {
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
  }, []);

  const clearToggleAnimation = useCallback(() => {
    clearAnimationTimeout();

    setToggleAnimation(null);
  }, [clearAnimationTimeout]);

  const queueToggleAnimation = useCallback((direction) => {
    if (!animateOnUserToggleOnly) return;

    clearToggleAnimation();
    setToggleAnimation(direction);
    animationTimeoutRef.current = setTimeout(() => {
      animationTimeoutRef.current = null;
      setToggleAnimation(null);
    }, USER_TOGGLE_ANIMATION_MS);
  }, [animateOnUserToggleOnly, clearToggleAnimation]);

  useEffect(() => {
    return () => {
      clearAnimationTimeout();
    };
  }, [clearAnimationTimeout]);

  useEffect(() => {
    clearToggleAnimation();
    loaded.current = false;

    browser.storage.local.get(_id).then((items) => {
        if (!loaded.current) {
            setIsChecked(!!items[_id]);
            loaded.current = true;
        }
    });

    const onStorageChanged = (changes) => {
        if (changes[_id] && changes[_id].newValue !== undefined) {
            loaded.current = true;
            setIsChecked(!!changes[_id].newValue);
        }
    };
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => browser.storage.onChanged.removeListener(onStorageChanged);
  }, [_id, clearToggleAnimation]);

  useEffect(() => {
    if (!loaded.current) return;
    const localStorageObj = {};
    localStorageObj[_id] = disabled ? false : isChecked;
    browser.storage.local.set(localStorageObj);
  }, [disabled, isChecked, _id]);

  const toggle = useCallback((event) => {
    const target = event.target;
    if (onBeforeChange && onBeforeChange(target.checked) === false) {
      // Veto: keep the input in sync with the unchanged state.
      target.checked = !target.checked;
      return;
    }
    setIsChecked(target.checked);
    queueToggleAnimation(target.checked ? 'on' : 'off');
    const localStorageObj = {};
    localStorageObj[_id] = target.checked;
    browser.storage.local.set(localStorageObj);
  }, [_id, queueToggleAnimation, onBeforeChange]);

  const wrapperClassName = [
    className,
    animateOnUserToggleOnly ? 'switch switch--manual-animation' : '',
    toggleAnimation === 'on' ? 'switch--animate-on' : '',
    toggleAnimation === 'off' ? 'switch--animate-off' : '',
  ].filter(Boolean).join(' ');

  return <span {...otherProps} className={wrapperClassName || undefined} data-tooltip-class-name="small-tooltip">
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
