import React, { useEffect, useState } from 'react';
import Modal from 'react-modal';
import { useAtom, useAtomValue } from 'jotai';
import { MdClose, MdArrowBack } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { aiToolsModalOpenState } from './atoms/aiState';
import { viewContextState } from './atoms/globalAppSettingsState';
import { AI_TOOLS } from './ai/aiTasks';
import { suggestCollectionName } from './ai/tasks/suggestCollectionName';
import { loadAllCollections } from './utils/storageUtils';
import { showSuccessToast } from './toastHelpers';
import './Modal.css';
import './AIToolsModal.css';

function AIToolsModal({ updateCollection }) {
    const [isOpen, setIsOpen] = useAtom(aiToolsModalOpenState);
    const viewContext = useAtomValue(viewContextState);
    const [activeToolId, setActiveToolId] = useState(null);
    const [collections, setCollections] = useState([]);
    const [selectedUid, setSelectedUid] = useState('');
    const [suggestion, setSuggestion] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        setActiveToolId(null);
        setSelectedUid('');
        setSuggestion('');
        setError(null);
        loadAllCollections().then(setCollections).catch((loadError) => {
            console.error('Tabox AI: failed to load collections', loadError);
            setCollections([]);
        });
    }, [isOpen]);

    const close = () => setIsOpen(false);
    // Empty collections produce a degenerate prompt — keep them out of the picker.
    const nameableCollections = collections.filter((collection) => (collection.tabs || []).length > 0);
    const selectedCollection = nameableCollections.find((collection) => collection.uid === selectedUid);

    const handleSuggest = async () => {
        if (!selectedCollection) return;
        setLoading(true);
        setError(null);
        try {
            setSuggestion(await suggestCollectionName(selectedCollection));
        } catch (suggestError) {
            console.error('Tabox AI name suggestion failed:', suggestError);
            setError('Could not generate a suggestion. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleApply = async () => {
        const trimmed = suggestion.trim();
        if (!selectedCollection || !trimmed) return;
        await updateCollection({
            ...selectedCollection,
            name: trimmed.substring(0, 50),
            lastUpdated: Date.now(),
        }, true);
        showSuccessToast('Collection renamed!');
        close();
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={close}
            contentLabel="Tabox AI Tools"
            className={`modal-content ai-tools-modal${viewContext === 'fullpage' ? ' ai-tools-modal--fullpage' : ''}`}
            overlayClassName="modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <div className="ai-tools-modal-content">
                <div className="ai-tools-modal-header">
                    <div className="ai-tools-modal-title">
                        {activeToolId ? (
                            <button type="button" className="ai-tools-back" onClick={() => setActiveToolId(null)} aria-label="Back to tools">
                                <MdArrowBack size={18} />
                            </button>
                        ) : (
                            <BsStars className="ai-tools-title-icon" size={18} />
                        )}
                        <span>{activeToolId ? AI_TOOLS.find((tool) => tool.id === activeToolId)?.title : 'Tabox AI'}</span>
                    </div>
                    <button className="ai-tools-modal-close" onClick={close} type="button" aria-label="Close">
                        <MdClose />
                    </button>
                </div>

                {!activeToolId && (
                    <div className="ai-tools-list">
                        {AI_TOOLS.map((tool) => {
                            const ToolIcon = tool.icon;
                            return (
                                <button key={tool.id} type="button" className="ai-tool-card" onClick={() => setActiveToolId(tool.id)}>
                                    <ToolIcon size={22} className="ai-tool-card-icon" />
                                    <span className="ai-tool-card-title">{tool.title}</span>
                                    <span className="ai-tool-card-description">{tool.description}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {activeToolId === 'auto-rename' && (
                    <div className="ai-tool-panel">
                        <label className="ai-tool-label" htmlFor="ai-rename-collection">Collection</label>
                        <select
                            id="ai-rename-collection"
                            className="ai-tool-select"
                            value={selectedUid}
                            onChange={(e) => { setSelectedUid(e.target.value); setSuggestion(''); setError(null); }}
                        >
                            <option value="">Choose a collection…</option>
                            {nameableCollections.map((collection) => (
                                <option key={collection.uid} value={collection.uid}>
                                    {collection.name} ({(collection.tabs || []).length} tabs)
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            className="ai-tool-action-btn"
                            onClick={handleSuggest}
                            disabled={!selectedUid || loading}
                        >
                            <BsStars size={14} style={{ marginRight: '6px' }} />
                            {loading ? 'Thinking…' : suggestion ? 'Suggest again' : 'Suggest name'}
                        </button>

                        {suggestion && (
                            <div className="ai-tool-suggestion">
                                <label className="ai-tool-label" htmlFor="ai-rename-suggestion">Suggested name (editable)</label>
                                <input
                                    id="ai-rename-suggestion"
                                    type="text"
                                    className="ai-tool-suggestion-input"
                                    maxLength={50}
                                    value={suggestion}
                                    onChange={(e) => setSuggestion(e.target.value)}
                                />
                                <button type="button" className="ai-tool-apply-btn" onClick={handleApply} disabled={!suggestion.trim()}>
                                    Apply
                                </button>
                            </div>
                        )}

                        {error && <div className="ai-tool-error">{error}</div>}
                    </div>
                )}
            </div>
        </Modal>
    );
}

export default AIToolsModal;
