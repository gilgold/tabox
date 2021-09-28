import React, { useEffect, useRef, useState } from 'react';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import './AddNewTextbox.css';
import { settingsDataState } from './atoms/settingsDataState';
import { isHighlightedState } from './atoms/globalAppSettingsState';
import { rowToHighlightState } from './atoms/animationsState';
import { getCurrentTabsAndGroups } from './utils';
import { browser } from '../static/globals';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';


function SaveHighlightedOnlyLabel(props) {
    const isHighlighted = useRecoilValue(isHighlightedState);
    const [totalHighlighted, setTotalHighlighted] = useState(0);

    useEffect(async () => {
        const total = (await browser.tabs.query({highlighted:true})).length;
        setTotalHighlighted(total);
    }, [])

    return <span className="highlighted_note" style={{display:(isHighlighted ? 'inline-block' : 'none')}}>Save <span className="highlighter">{totalHighlighted} selected</span> tabs</span>
}

const useFocus = () => {
    const htmlElRef = useRef(null)
    const setFocus = () => {htmlElRef.current && htmlElRef.current.focus()}

    return [ htmlElRef, setFocus ]
}

function AddNewTextbox(props) {

    const [collectionName, setName] = useState("");
    const [disabled, setDisabled] = useState(false);
    const [inputRef, setInputFocus] = useFocus();
    const settingsData = useRecoilValue(settingsDataState);
    const isHighlighted = useRecoilValue(isHighlightedState);
    const setRowToHighlight = useSetRecoilState(rowToHighlightState);
    const [openSnackbar, closeSnackbar] = useSnackbar({style: SnackbarStyle.ERROR});

    useEffect(() => {
        setInputFocus();
    }, [])


    async function handleSave() {
        if (collectionName.trim() === '') {
            openSnackbar('Please enter a name for the collection', 2000);
            return;
        }
        setDisabled(true);
        const newItem = await getCurrentTabsAndGroups(collectionName, isHighlighted);
        const newSettingsData = settingsData ? [newItem, ...settingsData] : [newItem];
        setRowToHighlight(0);
        await props.updateRemoteData(newSettingsData);
        setTimeout(() => setDisabled(false), 1000);
    }

    async function _handleKeyDown(e) {
        if (e.key === 'Enter') {
            await handleSave();
        }
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
                        onChange={e => setName(e.target.value)}
                        ref={inputRef}
                        style={{
                            float: 'left',
                            width: '290px',
                        }}
                    />
                    <span
                        className="bar"
                        style={{
                            float: 'left',
                            width: '290px',
                        }}></span>
                    <label className="textbox_label">Save {isHighlighted ? 'selected' : 'all'} tabs as...</label>
                </div>
                <button
                    id="add_new_setting"
                    disabled={disabled}
                    className="btn"
                    onClick={async () => await handleSave()}
                    >
                        <span>Add</span>
                    </button>
                <SaveHighlightedOnlyLabel />
            </section>;
};

export default AddNewTextbox;