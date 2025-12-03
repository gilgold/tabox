import React, { useState, useEffect, useRef } from 'react';
import './AutoSaveTextbox.css';
import { AiFillEdit } from 'react-icons/ai';

const TypingLoader = () => <div className="lds-ring"><div /><div /><div /><div /></div>;

export const AutoSaveTextbox = (props) => {
    const [value, setValue] = useState(props.initValue);
    const [saved, setSaved] = useState(false);
    const [typing, setTyping] = useState(false);
    const [isInitial, setIsInitial] = useState(true);
    const inputRef = useRef();
    const mountedRef = useRef(true);
    const timeoutRefs = useRef({
        action: null,
        typing: null,
        saved: null,
        initial: null
    });

    const handleOnChange = (event) => {
        setSaved(false);
        if (props.onChange) props.onChange(event.target.value);
        setValue(event.target.value);
    };

    // Cleanup function
    const clearAllTimeouts = () => {
        Object.values(timeoutRefs.current).forEach(timeout => {
            if (timeout) clearTimeout(timeout);
        });
        timeoutRefs.current = {
            action: null,
            typing: null,
            saved: null,
            initial: null
        };
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            mountedRef.current = false;
            clearAllTimeouts();
        };
    }, []);

    useEffect(() => {
        setValue(props.initValue);
        setIsInitial(false);
    }, []);

    useEffect(() => {
        clearAllTimeouts();
        
        if (mountedRef.current) {
            setIsInitial(true);
            setValue(props.initValue);
        }
        
        timeoutRefs.current.initial = setTimeout(() => {
            if (mountedRef.current) {
                setIsInitial(false);
            }
        }, 200);

        return () => {
            clearAllTimeouts();
            if (mountedRef.current) {
                setTyping(false);
                setSaved(false);
            }
        };
    }, [props.initValue]);

    useEffect(() => {
        if (isInitial) return;
        
        clearAllTimeouts();
        
        if (mountedRef.current) {
            setTyping(true);
        }
        
        timeoutRefs.current.action = setTimeout(() => {
            if (mountedRef.current) {
                props.action(value.trim(), props.item);
                
                timeoutRefs.current.typing = setTimeout(() => {
                    if (mountedRef.current) {
                        setTyping(false);
                        setSaved(true);
                    }
                }, 100);
                
                timeoutRefs.current.saved = setTimeout(() => {
                    if (mountedRef.current) {
                        setSaved(false);
                    }
                }, 2300);
            }
        }, 700);

        return () => {
            clearAllTimeouts();
        };
    }, [value]);

    return (
        <div className="autosave-wrapper" onClick={(e) => e.stopPropagation()}>
            <div className="edit-icon" onClick={(e) => { e.stopPropagation(); inputRef.current.focus(); }}>
                <AiFillEdit size="14px" color="var(--text-color)" />
            </div>
            <input 
                ref={inputRef} 
                className="autosave-textbox" 
                placeholder={props.placeholder || "Enter name..."} 
                maxLength={props.maxLength ?? -1}
                onChange={handleOnChange} 
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                
                data-tooltip-id="main-tooltip" data-tooltip-content="Click to edit • Auto-saves as you type" 
                data-tooltip-class-name="small-tooltip"
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