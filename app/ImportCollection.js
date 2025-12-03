import React from 'react'
import { applyUid } from './utils'
import './ImportCollection.css';
import { useAtomValue, useSetAtom } from 'jotai';
import { settingsDataState } from './atoms/globalAppSettingsState';
import { highlightedCollectionUidState } from './atoms/animationsState';
import { showSuccessToast, showErrorToast } from './toastHelpers';

import { FaFileImport } from 'react-icons/fa';


function ImportCollection(props) {

    const settingsData = useAtomValue(settingsDataState);
    const setHighlightedCollectionUid = useSetAtom(highlightedCollectionUidState);

    const generateUID = () => {
        return (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    };

    // Helper function to generate unique names with numbering
    const generateUniqueName = async (originalName, type = 'collection') => {
        const { loadAllCollections, loadAllFolders } = await import('./utils/storageUtils');
        
        let existingNames = [];
        if (type === 'collection') {
            const collections = await loadAllCollections();
            existingNames = collections.map(c => c.name);
        } else if (type === 'folder') {
            const folders = await loadAllFolders();
            existingNames = folders.map(f => f.name);
        }

        // If name doesn't exist, return it as-is
        if (!existingNames.includes(originalName)) {
            return originalName;
        }

        // Find the next available number
        let counter = 1;
        let newName = `${originalName} (${counter})`;
        
        while (existingNames.includes(newName)) {
            counter++;
            newName = `${originalName} (${counter})`;
        }
        
        return newName;
    };

    const handleFileSelection = async (event) => {
        const file = event.target.files[0];
        if (!event.target.value.endsWith('.txt')) {
            showErrorToast('Invalid file: Please select a .txt file');
            event.target.value = '';
            return;
        }
        
        let reader = new FileReader();
        reader.onload = async function () {
            const result = reader.result;
            
            // More flexible JSON validation
            const trimmedResult = result.trim();
            if (!trimmedResult.startsWith('{') && !trimmedResult.startsWith('[')) {
                showErrorToast('Invalid File: File does not contain valid JSON data');
                event.target.value = '';
                return;
            }
            
            try {
                let parsed = JSON.parse(trimmedResult);
                await handleImportData(parsed);
                event.target.value = '';
            }
            catch (error) {
                console.error('Import error:', error);
                showErrorToast('Invalid File: Unable to parse JSON - ' + error.message);
                event.target.value = '';
                return;
            }
        }
        reader.readAsText(file);
    };

    const handleImportData = async (parsed) => {
        // Detect import type based on structure
        if (parsed.type === 'full_export') {
            await handleFullExportImport(parsed);
        } else if (parsed.type === 'folder') {
            await handleFolderImport(parsed);
        } else if (Array.isArray(parsed)) {
            await handleLegacyCollectionsImport(parsed);
        } else if (parsed.tabs && Array.isArray(parsed.tabs)) {
            await handleSingleCollectionImport(parsed);
        } else {
            throw new Error('Unknown import format');
        }
    };

    const handleFullExportImport = async (exportData) => {
        try {
            const { saveSingleFolder, saveSingleCollection } = await import('./utils/storageUtils');
            let importedCollections = [];
            let importedFolders = [];

            // Import folders first
            if (exportData.folders && exportData.folders.length > 0) {
                for (const folder of exportData.folders) {
                    // Generate new UID to avoid conflicts
                    const newFolderUid = generateUID();
                    const uniqueName = await generateUniqueName(folder.name, 'folder');
                    const importedFolder = {
                        ...folder,
                        uid: newFolderUid,
                        name: uniqueName,
                        lastUpdated: Date.now()
                    };
                    
                    await saveSingleFolder(importedFolder);
                    importedFolders.push(importedFolder);
                    
                    // Update collections that belong to this folder
                    if (exportData.collections) {
                        exportData.collections.forEach(collection => {
                            if (collection.parentId === folder.uid) {
                                collection.parentId = newFolderUid;
                            }
                        });
                    }
                }
            }

            // Import collections
            if (exportData.collections && exportData.collections.length > 0) {
                for (const collection of exportData.collections) {
                    // Generate new UID to avoid conflicts
                    const newCollectionUid = generateUID();
                    const uniqueName = await generateUniqueName(collection.name, 'collection');
                    let importedCollection = {
                        ...collection,
                        uid: newCollectionUid,
                        name: uniqueName,
                        createdOn: Date.now(),
                        lastUpdated: Date.now()
                    };

                    // Apply UIDs to tabs if needed
                    if (importedCollection.tabs && importedCollection.tabs.length > 0 && !('uid' in importedCollection.tabs[0])) {
                        importedCollection = applyUid(importedCollection);
                    }

                    await saveSingleCollection(importedCollection);
                    importedCollections.push(importedCollection);
                }
            }

            // Update the UI by refreshing both collections and folders
            if (props.onDataUpdate) {
                await props.onDataUpdate();
            } else if (props.updateRemoteData) {
                const { loadAllCollections } = await import('./utils/storageUtils');
                const updatedCollections = await loadAllCollections();
                await props.updateRemoteData(updatedCollections);
            }

            // Highlight first imported collection
            if (importedCollections.length > 0) {
                setHighlightedCollectionUid(importedCollections[0].uid);
            }

            showSuccessToast(`Successfully imported ${importedFolders.length} folders and ${importedCollections.length} collections`);
        } catch (error) {
            console.error('Error importing full export:', error);
            showErrorToast('Error importing data: ' + error.message);
        }
    };

    const handleFolderImport = async (folderData) => {
        try {
            const { saveSingleFolder, saveSingleCollection } = await import('./utils/storageUtils');
            
            // Import the folder with new UID
            const newFolderUid = generateUID();
            const uniqueFolderName = await generateUniqueName(folderData.folder.name, 'folder');
            const importedFolder = {
                ...folderData.folder,
                uid: newFolderUid,
                name: uniqueFolderName,
                lastUpdated: Date.now()
            };
            
            await saveSingleFolder(importedFolder);

            // Import collections in the folder
            let importedCollections = [];
            if (folderData.collections && folderData.collections.length > 0) {
                for (const collection of folderData.collections) {
                    const newCollectionUid = generateUID();
                    const uniqueCollectionName = await generateUniqueName(collection.name, 'collection');
                    let importedCollection = {
                        ...collection,
                        uid: newCollectionUid,
                        name: uniqueCollectionName,
                        parentId: newFolderUid,
                        createdOn: Date.now(),
                        lastUpdated: Date.now()
                    };

                    if (importedCollection.tabs && importedCollection.tabs.length > 0 && !('uid' in importedCollection.tabs[0])) {
                        importedCollection = applyUid(importedCollection);
                    }

                    await saveSingleCollection(importedCollection);
                    importedCollections.push(importedCollection);
                }
            }

            // Update the UI - refresh both collections and folders
            if (props.onDataUpdate) {
                await props.onDataUpdate();
            } else if (props.updateRemoteData) {
                const { loadAllCollections } = await import('./utils/storageUtils');
                const updatedCollections = await loadAllCollections();
                await props.updateRemoteData(updatedCollections);
            }

            // Highlight first imported collection
            if (importedCollections.length > 0) {
                setHighlightedCollectionUid(importedCollections[0].uid);
            }

            showSuccessToast(`Successfully imported folder "${importedFolder.name}" with ${importedCollections.length} collections`);
        } catch (error) {
            console.error('Error importing folder:', error);
            showErrorToast('Error importing folder: ' + error.message);
        }
    };

    const handleLegacyCollectionsImport = async (collections) => {
        try {
            // Legacy array of collections import - apply unique names
            const collectionsWithUniqueNames = [];
            for (const collection of collections) {
                const uniqueName = await generateUniqueName(collection.name, 'collection');
                collectionsWithUniqueNames.push({
                    ...collection,
                    name: uniqueName
                });
            }
            
            let newData = [...collectionsWithUniqueNames, ...settingsData];
            await props.updateRemoteData(newData);
            
            if (collectionsWithUniqueNames.length > 0) {
                setHighlightedCollectionUid(collectionsWithUniqueNames[0].uid);
            }
            
            showSuccessToast(`Successfully imported ${collectionsWithUniqueNames.length} collections`);
        } catch (error) {
            console.error('Error importing legacy collections:', error);
            showErrorToast('Error importing collections: ' + error.message);
        }
    };

    const handleSingleCollectionImport = async (collection) => {
        try {
            // Legacy single collection import with unique name
            const uniqueName = await generateUniqueName(collection.name, 'collection');
            let newItem = {...collection, name: uniqueName};
            newItem['createdOn'] = Date.now();
            if (newItem && newItem.tabs.length > 0 && !('uid' in newItem.tabs[0])) {
                newItem = applyUid(newItem);
            }
            
            let newData = [newItem, ...settingsData];
            await props.updateRemoteData(newData);
            setHighlightedCollectionUid(newItem.uid);
            
            showSuccessToast(`Successfully imported collection "${newItem.name}"`);
        } catch (error) {
            console.error('Error importing single collection:', error);
            showErrorToast('Error importing collection: ' + error.message);
        }
    };
    return <span className="image-upload">
            <label htmlFor="file-input" className="input-label">
                <div className="import-button">
                    <FaFileImport style={{ color: 'var(--text-color)' }} className="import-icon" size="16px" /> <span>Import file</span>
                </div>
            </label>
            <input id="file-input" type="file" onChange={handleFileSelection} />
        </span>;
}

export default ImportCollection;