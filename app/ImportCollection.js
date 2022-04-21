import React from 'react'
import { applyUid } from './utils'
import './ImportCollection.css';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { settingsDataState } from './atoms/globalAppSettingsState';
import { rowToHighlightState } from './atoms/animationsState';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';
import { FaFileImport } from 'react-icons/fa';


function ImportCollection(props) {

    const settingsData = useRecoilValue(settingsDataState);
    const setRowToHighlight = useSetRecoilState(rowToHighlightState);
    const [openSnackbar, ] = useSnackbar({ style: SnackbarStyle.ERROR });

    const handleFileSelection = (event) => {
        const file = event.target.files[0];
        if (!event.target.value.endsWith('.txt')) {
            openSnackbar('Invalid file: Please select a .txt file', 4000);
            event.target.value = '';
            return;
        }
        let reader = new FileReader();
        reader.onload = function () {
            const result = reader.result;
            if (!result.startsWith('{"') && !result.startsWith('[{')) {
                openSnackbar('Invalid File: This file is not a valid collection', 4000);
                event.target.value = '';
                return;
            }
            
            try {
                let newData;
                let parsed = JSON.parse(result);
                if (Array.isArray(parsed)) {
                    newData = [...parsed, ...settingsData];
                } else {
                    let newItem = parsed;
                    newItem['createdOn'] = Date.now();
                    if (newItem && newItem.tabs.length > 0 && !('uid' in newItem.tabs[0])) newItem = applyUid(newItem);
                    newData = [newItem, ...settingsData];
                }
                props.updateRemoteData(newData).then(() => {
                    setRowToHighlight(0);
                    event.target.value = '';
                });
            }
            catch {
                openSnackbar('Invalid File: This file is not a valid collection', 4000);
                event.target.value = '';
                return;
            }
        }
        reader.readAsText(file);

    };
    return <span className="image-upload">
            <label htmlFor="file-input" className="input-label">
                <div className="import-button">
                    <FaFileImport color="#fff" className="import-icon" size="16px" /> <span>Import Collections</span>
                </div>
            </label>
            <input id="file-input" type="file" onChange={handleFileSelection} />
        </span>;
}

export default ImportCollection;