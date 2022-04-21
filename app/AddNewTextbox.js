import React, { useEffect, useRef, useState } from 'react';
import { useSetRecoilState } from 'recoil';
import './AddNewTextbox.css';
import { searchState } from './atoms/globalAppSettingsState';
import { getCurrentTabsAndGroups } from './utils';
import { browser } from '../static/globals';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { IoClose } from 'react-icons/io5';


function SaveHighlightedOnlyLabel() {
    const [totalHighlighted, setTotalHighlighted] = useState(0);

    useEffect(async () => {
        const windowId = await browser.windows.WINDOW_ID_CURRENT;
        const total = (await browser.tabs.query({ highlighted: true, windowId: windowId })).length;
        setTotalHighlighted(total);
    }, [])

    return <span className="highlighted_note" style={{ display: (totalHighlighted > 1 ? 'inline-block' : 'none') }}>Save <span className="highlighter">{totalHighlighted} selected</span> tabs</span>
}

const useFocus = () => {
    const htmlElRef = useRef(null)
    const setFocus = () => { htmlElRef.current && htmlElRef.current.focus() }

    return [htmlElRef, setFocus]
}

function AddNewTextbox(props) {

    const [collectionName, setName] = useState("");
    const [disabled, setDisabled] = useState(false);
    const [inputRef, setInputFocus] = useFocus();
    const [openSnackbar] = useSnackbar({ style: SnackbarStyle.ERROR });
    const setSearch = useSetRecoilState(searchState);
    const [hideClear, setHideClear] = useState(true);

    useEffect(() => {
        setInputFocus();
    }, [])

    useEffect(() => {
        if (collectionName === "") {
            setHideClear(true);
        } else {
            setHideClear(false);
        }
    }, [collectionName]);


    const handleSave = async () => {
        console.log("add new collection", collectionName);
        if (collectionName.trim() === '') {
            openSnackbar('Please enter a name for the collection', 2000);
            return;
        }
        setSearch(null);
        setDisabled(true);
        const newItem = await getCurrentTabsAndGroups(collectionName);
        await props.addCollection(newItem);
        setTimeout(() => setDisabled(false), 1000);
    }

    const _handleKeyDown = async (e) => {
        if (e.key === 'Enter') {
            await handleSave();
        }
    }

    const _handleInputChange = (e) => {
        setSearch(e.target.value.trim() !== '' ? e.target.value : null);
        setName(e.target.value);
    }

    const handleClear = () => {
        setSearch('');
        setName('');
        setInputFocus();
    }

    return <section>
        <div className="group">
            <input
                type="text"
                maxLength="50"
                placeholder=" "
                name="new_setting_title"
                id="new_setting_title"
                onKeyDown={async e => await _handleKeyDown(e)}
                onChange={_handleInputChange}
                ref={inputRef}
                value={collectionName} />
            <span className="bar"></span>
            <label className="textbox_label">Search or Add collections</label>
            <button
                className="clear-button"
                style={{ opacity: hideClear ? '0' : '1' }}
                disabled={hideClear}
                onClick={handleClear}>
                <IoClose size="16px" />
            </button>
        </div>
        <button
            id="add_new_setting"
            disabled={disabled}
            className="btn"
            onClick={handleSave}
        >
            <span>Add</span>
        </button>
        <SaveHighlightedOnlyLabel />
    </section>;
}

export default AddNewTextbox;