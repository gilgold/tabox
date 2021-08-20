import React, { useState, useEffect, useRef } from 'react';
import './AutoSaveTextbox.css';

const TypingLoader = () => <div className="lds-ring"><div /><div /><div /><div /></div>;

export const AutoSaveTextbox = (props) => {
    const [value, setValue] = useState(props.initValue);
    const [saved, setSaved] = useState(false);
    const [typing, setTyping] = useState(false);
    const [isInitial, setIsInitial] = useState(true);
    const inputRef = useRef();

    const handleOnChange = (event) => {
        setSaved(false);
        if (props.onChange) props.onChange(event.target.value);
        setValue(event.target.value);
    };

    useEffect(() => {
        setValue(props.initValue);
        setIsInitial(false);
    }, []);

    useEffect(() => {
        setIsInitial(true);
        setValue(props.initValue);
        const isInitialTimer = setTimeout(() => setIsInitial(false), 200);
        return () => {
            clearTimeout(isInitialTimer);
            setTyping(false);
            setSaved(false);
        };
    }, [props.initValue]);

    useEffect(() => {
        if (isInitial) return;
        setTyping(true);
        let typingTimer;
        let savedTimer;    
        const timeoutId = setTimeout(() => {
            props.action(value.trim(), props.item);
            typingTimer = setTimeout(() => {setTyping(false); setSaved(true);}, 100);
            savedTimer = setTimeout(() => setSaved(false), 2300);
        }, 700);
        return () => {
            clearTimeout(typingTimer);
            clearTimeout(savedTimer);
            clearTimeout(timeoutId);
        };
    }, [value]);

    return (
        <div className="autosave-wrapper">
            <div className="edit-icon" onClick={() => inputRef.current.focus()}>
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.125 12.2187V14.8749H4.78125L12.6154 7.04077L9.95917 4.38452L2.125 12.2187ZM14.6696 4.98661C14.9458 4.71036 14.9458 4.26411 14.6696 3.98786L13.0121 2.33036C12.7358 2.05411 12.2896 2.05411 12.0133 2.33036L10.7171 3.62661L13.3733 6.28286L14.6696 4.98661V4.98661Z" fill="var(--text-color)"/>
                </svg>
            </div>
            <input 
                ref={inputRef} 
                className="autosave-textbox" 
                placeholder="No name" 
                maxLength={props.maxLength ?? -1}
                onChange={handleOnChange} 
                data-multiline={true} 
                data-tip="Type here to edit.<br />Changes are saved automatically." 
                data-class="small-tooltip"
                value={value} />
            {saved ? (
                <svg key={`saved-${saved}`} className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                    <circle className="checkmark__circle" cx="26" cy="26" r="25" fill="none" />
                    <path className="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
                </svg>
            ) : typing ? <TypingLoader /> : null }
        </div>
    );
};