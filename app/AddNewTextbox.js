import React, { useEffect, useRef, useState } from 'react';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import './AddNewTextbox.css';
import { settingsDataState } from './atoms/settingsDataState';
import { isHighlightedState } from './atoms/globalAppSettingsState';
import { rowToHighlightState } from './atoms/animationsState';
import { getCurrentTabsAndGroups } from './utils';
import { browser } from '../static/index';
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

    const [confName, setName] = useState("");
    const [inputRef, setInputFocus] = useFocus();
    const settingsData = useRecoilValue(settingsDataState);
    const isHighlighted = useRecoilValue(isHighlightedState);
    const setRowToHighlight = useSetRecoilState(rowToHighlightState);
    const [openSnackbar, closeSnackbar] = useSnackbar({style: SnackbarStyle.ERROR});

    useEffect(() => {
        setInputFocus();
    }, [])


    async function handleSave() {
        const confTitle = confName ? confName.replace("'",'&#39;') : "";
        if (confTitle.trim() === '') {
            openSnackbar('Please enter a name for the collection', 2000);
            return;
        }
        const newItem = await getCurrentTabsAndGroups(confTitle, isHighlighted);
        const newSettingsData = [newItem, ...settingsData];
        setRowToHighlight(0);
        props.updateRemoteData(newSettingsData);
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
                        maxLength="40" 
                        placeholder=" " 
                        name="new_setting_title" 
                        id="new_setting_title"
                        onKeyDown={async e => await _handleKeyDown(e)} 
                        onChange={e => setName(e.target.value)} 
                        ref={inputRef}  />
                    <span className="bar"></span>
                    <label className="textbox_label">Save {isHighlighted ? 'selected' : 'all'} tabs as...</label>
                </div>
                <button 
                    id="add_new_setting" 
                    className="btn"
                    onClick={async () => await handleSave()}
                    >
                        <span>Add</span>
                    </button>
                <SaveHighlightedOnlyLabel />
            </section>;
};

export default AddNewTextbox;