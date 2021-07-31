import React from 'react'
import { applyUid, convertOldStringToDataArray } from './utils'
import './ImportCollection.css';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { settingsDataState } from './atoms/settingsDataState';
import { rowToHighlightState } from './atoms/animationsState';
import { useSnackbar } from 'react-simple-snackbar';
import { SnackbarStyle } from './model/SnackbarTypes';


function ImportCollection(props) {

    const settingsData = useRecoilValue(settingsDataState);
    const setRowToHighlight = useSetRecoilState(rowToHighlightState);
    const [openSnackbar, closeSnackbar] = useSnackbar({style: SnackbarStyle.ERROR});

    const handleFileSelection = (event) => {
        const file = event.target.files[0];
        if (!event.target.value.endsWith('.txt')) {
            openSnackbar('Invalid file: Please select a .txt file', 4000);
            event.target.value = '';
            return;
        }
        let reader = new FileReader();
        reader.onload = function (e) {
            const result = reader.result;
            if (result.indexOf('`') == -1 && !result.startsWith('{"')) {
                openSnackbar('Invalid File: This file is not a valid collection', 4000);
                event.target.value = '';
                return;
            }
            let newItem;
            if (result.indexOf('`') > -1) {
                newItem = convertOldStringToDataArray(result)[0];
            }
            if (result.startsWith('{"')) {
                newItem = JSON.parse(result);
                newItem['createdOn'] = Date.now();
            }
            if (!('uid' in newItem.tabs[0])) newItem = applyUid(newItem);
            const newData = [newItem, ...settingsData];
            props.updateRemoteData(newData).then(() => {
                setRowToHighlight(0);
                event.target.value = '';
            });
        }
        reader.readAsText(file);

    };
    return <span className="image-upload">
            <label htmlFor="file-input">
            <img src="images/import_file.png" /> <span>Import a collection from file</span>
            </label>
            <input id="file-input" type="file" onChange={handleFileSelection} />
        </span>;
};

export default ImportCollection;