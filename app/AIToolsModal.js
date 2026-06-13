import React, { useEffect, useRef, useState } from 'react';
import Modal from 'react-modal';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { MdClose, MdArrowBack } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { aiToolsModalOpenState, aiToolsScopeState, aiProcessingUidsState, aiProcessingCurrentUidState } from './atoms/aiState';
import { viewContextState } from './atoms/globalAppSettingsState';
import { AI_TOOLS } from './ai/aiTasks';
import { autoRenameCollections } from './ai/tasks/autoRenameCollections';
import { getAIAvailability } from './ai/aiClient';
import { loadAllCollections } from './utils/storageUtils';
import { showUndoToast } from './toastHelpers';
import { UNDO_TIME } from './constants';
import './Modal.css';
import './AIToolsModal.css';

function AIToolsModal({ updateRemoteData }) {
    const [isOpen, setIsOpen] = useAtom(aiToolsModalOpenState);
    const scope = useAtomValue(aiToolsScopeState);
    const viewContext = useAtomValue(viewContextState);
    const setAiProcessingUids = useSetAtom(aiProcessingUidsState);
    const setAiProcessingCurrentUid = useSetAtom(aiProcessingCurrentUidState);
    const [activeToolId, setActiveToolId] = useState(null);
    const [collections, setCollections] = useState([]);
    // Panel state machine: idle | running | done
    const [panelStatus, setPanelStatus] = useState('idle');
    const [renameResults, setRenameResults] = useState([]); // live list of {uid, oldName, newName} | {uid, reason}
    const [skipped, setSkipped] = useState([]);
    const [wasCancelled, setWasCancelled] = useState(false);
    const [error, setError] = useState(null);
    const [isCancelling, setIsCancelling] = useState(false);
    // Bulk-run progress (i/N label + determinate bar)
    const [progressLabel, setProgressLabel] = useState('');
    const [progressFill, setProgressFill] = useState(0); // 0–100

    // Abort controller for the running engine
    const abortControllerRef = useRef(null);
    // Run token to invalidate stale async state updates
    const runTokenRef = useRef(0);
    // Synchronous re-entry guard — set before any await in handleRun so a
    // double-click cannot start two engine runs.
    const runStartedRef = useRef(false);

    useEffect(() => {
        if (!isOpen) return;
        // Abort any in-flight run from a previous session
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        runTokenRef.current += 1;
        runStartedRef.current = false;
        // Clear AI processing atoms from any previous run
        setAiProcessingUids([]);
        setAiProcessingCurrentUid(null);
        // Reset all panel state
        setCollections([]);
        setActiveToolId(null);
        setPanelStatus('idle');
        setRenameResults([]);
        setSkipped([]);
        setWasCancelled(false);
        setError(null);
        setIsCancelling(false);
        setProgressLabel('');
        setProgressFill(0);
        loadAllCollections().then(setCollections).catch((loadError) => {
            console.error('Tabox AI: failed to load collections', loadError);
            setCollections([]);
        });
    }, [isOpen, setAiProcessingUids, setAiProcessingCurrentUid]);

    // Abort on unmount and clear AI processing atoms
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            setAiProcessingUids([]);
            setAiProcessingCurrentUid(null);
        };
    }, [setAiProcessingUids, setAiProcessingCurrentUid]);

    const busy = panelStatus === 'running';
    const close = () => setIsOpen(false);

    // Collections that have tabs (can be renamed by AI)
    const nameableCollections = collections.filter((c) => (c.tabs || []).length > 0);

    // Apply scope filter
    const targets = scope.type === 'selected'
        ? nameableCollections.filter((c) => scope.uids.includes(c.uid))
        : nameableCollections;

    const handleRun = async () => {
        if (panelStatus !== 'idle' || targets.length === 0) return;
        if (runStartedRef.current) return;
        runStartedRef.current = true;

        // Pre-flight check
        const availability = await getAIAvailability();
        if (availability !== 'available') {
            // Pre-flight failed — allow retry
            runStartedRef.current = false;
            setError('Tabox AI is not ready on this device. Check the Tabox AI setting.');
            return;
        }

        const token = ++runTokenRef.current;
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setPanelStatus('running');
        setRenameResults([]);
        setSkipped([]);
        setWasCancelled(false);
        setError(null);
        setIsCancelling(false);
        setProgressLabel('');
        setProgressFill(0);
        setAiProcessingUids(targets.map((t) => t.uid));

        const total = targets.length;

        let engineResult;
        try {
            engineResult = await autoRenameCollections({
                collections: targets,
                signal: controller.signal,
                onProgress: (index, _total, collection) => {
                    if (token !== runTokenRef.current) return;
                    setProgressLabel(`Renaming ${index + 1} of ${total}: ${collection.name}`);
                    setProgressFill(Math.round((index / total) * 100));
                    setAiProcessingCurrentUid(collection.uid);
                },
                onResult: (entry) => {
                    if (token !== runTokenRef.current) return;
                    if (entry.newName) {
                        setRenameResults((prev) => [...prev, entry]);
                    } else {
                        setSkipped((prev) => [...prev, entry]);
                    }
                },
            });
        } catch (runError) {
            // Unexpected engine throw (shouldn't normally happen — AbortError is caught inside)
            console.error('Tabox AI: autoRenameCollections threw unexpectedly:', runError);
            if (token !== runTokenRef.current) return;
            setAiProcessingUids([]);
            setAiProcessingCurrentUid(null);
            setError('An unexpected error occurred. Please try again.');
            setPanelStatus('done');
            runStartedRef.current = false;
            return;
        }

        if (token !== runTokenRef.current) return;

        // Clear AI processing effects before applying results
        setAiProcessingUids([]);
        setAiProcessingCurrentUid(null);

        const { results, cancelled } = engineResult;
        setWasCancelled(cancelled);

        if (results.length > 0) {
            try {
                const fresh = await loadAllCollections();
                const byUid = Object.fromEntries(results.map((r) => [r.uid, r]));
                const patched = fresh.map((c) =>
                    c.uid in byUid ? { ...c, name: byUid[c.uid].newName, lastUpdated: Date.now() } : c
                );
                await updateRemoteData(patched);

                const renamed = results;
                showUndoToast(
                    <BsStars />,
                    `Renamed ${renamed.length} collection${renamed.length === 1 ? '' : 's'} with AI`,
                    'Tabox AI',
                    async () => {
                        const current = await loadAllCollections();
                        // Only revert names the user has not changed since the run.
                        const reverted = current.map((c) => {
                            if (c.uid in byUid && c.name === byUid[c.uid].newName) {
                                return { ...c, name: byUid[c.uid].oldName, lastUpdated: Date.now() };
                            }
                            return c;
                        });
                        await updateRemoteData(reverted);
                    },
                    UNDO_TIME,
                );
            } catch (applyError) {
                console.error('Tabox AI: failed to save renamed collections:', applyError);
                if (token !== runTokenRef.current) return;
                setError('Could not save the new names. Please try again.');
            }
        }

        if (token !== runTokenRef.current) return;
        setPanelStatus('done');
        runStartedRef.current = false;
    };

    const handleCancel = () => {
        if (!busy || isCancelling) return;
        setIsCancelling(true);
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    const n = targets.length;
    const idleDescription = n === 1
        ? 'Automatically rename 1 collection using on-device AI. You can review and undo afterwards.'
        : `Automatically rename ${n} collections using on-device AI. You can review and undo afterwards.`;

    const idleDisabledHint = n === 0
        ? (scope.type === 'selected'
            ? 'None of the selected collections can be renamed.'
            : 'No collections with tabs to rename.')
        : null;

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={busy ? undefined : close}
            contentLabel="Tabox AI Tools"
            className={`modal-content ai-tools-modal${viewContext === 'fullpage' ? ' ai-tools-modal--fullpage' : ''}`}
            overlayClassName="modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={!busy}
            shouldCloseOnEsc={!busy}
        >
            <div className="ai-tools-modal-content">
                <div className="ai-tools-modal-header">
                    <div className="ai-tools-modal-title">
                        {activeToolId ? (
                            <button
                                type="button"
                                className="ai-tools-back"
                                onClick={() => !busy && setActiveToolId(null)}
                                aria-label="Back to tools"
                                disabled={busy}
                            >
                                <MdArrowBack size={18} />
                            </button>
                        ) : (
                            <BsStars className="ai-tools-title-icon" size={18} />
                        )}
                        <span>{activeToolId ? AI_TOOLS.find((tool) => tool.id === activeToolId)?.title : 'Tabox AI'}</span>
                    </div>
                    <button className="ai-tools-modal-close" onClick={close} type="button" disabled={busy} aria-label="Close">
                        <MdClose />
                    </button>
                </div>

                {!activeToolId && (
                    <div className="ai-tools-list">
                        {AI_TOOLS.filter((t) => t.featured).map((tool) => {
                            const ToolIcon = tool.icon;
                            return (
                                <button key={tool.id} type="button" className="ai-hero-card" onClick={() => setActiveToolId(tool.id)}>
                                    <span className="ai-hero-badge">Flagship</span>
                                    <ToolIcon size={26} className="ai-hero-icon" />
                                    <span className="ai-hero-title">{tool.title}</span>
                                    <span className="ai-hero-description">{tool.description}</span>
                                </button>
                            );
                        })}
                        <div className="ai-tools-grid">
                            {AI_TOOLS.filter((t) => !t.featured).map((tool) => {
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
                    </div>
                )}

                {activeToolId === 'auto-rename' && (
                    <div className="ai-tool-panel">
                        {/* Idle state */}
                        {panelStatus === 'idle' && (
                            <>
                                <p className="ai-rename-description">{idleDescription}</p>
                                {idleDisabledHint && (
                                    <p className="ai-rename-hint">{idleDisabledHint}</p>
                                )}
                                {error && <div className="ai-tool-error">{error}</div>}
                                <button
                                    type="button"
                                    className="ai-tool-action-btn"
                                    onClick={handleRun}
                                    disabled={n === 0}
                                    aria-label={`Auto-rename ${n} collection${n === 1 ? '' : 's'}`}
                                >
                                    <BsStars size={14} style={{ marginRight: '6px' }} />
                                    {`Auto-rename ${n} collection${n === 1 ? '' : 's'}`}
                                </button>
                            </>
                        )}

                        {/* Running state */}
                        {panelStatus === 'running' && (
                            <>
                                <div className="ai-rename-progress">
                                    <div className="ai-rename-progress-track">
                                        {progressFill > 0 ? (
                                            <div
                                                className="ai-rename-progress-fill"
                                                style={{ width: `${progressFill}%` }}
                                            />
                                        ) : (
                                            <div className="ai-rename-progress-fill ai-rename-progress-fill--animated" />
                                        )}
                                    </div>
                                    <span className="ai-rename-progress-label">
                                        {isCancelling
                                            ? 'Finishing up…'
                                            : progressLabel || 'Renaming collections with AI…'}
                                    </span>
                                </div>
                                {renameResults.length > 0 && (
                                    <ul className="ai-rename-results">
                                        {renameResults.map((r) => (
                                            <li key={r.uid} className="ai-rename-result-row">
                                                <span className="ai-rename-old">{r.oldName}</span>
                                                <span className="ai-rename-arrow">→</span>
                                                <span className="ai-rename-new">{r.newName}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <button
                                    type="button"
                                    className="ai-tool-action-btn ai-tool-action-btn--cancel"
                                    onClick={handleCancel}
                                    disabled={isCancelling}
                                >
                                    {isCancelling ? 'Cancelling…' : 'Cancel'}
                                </button>
                            </>
                        )}

                        {/* Done state */}
                        {panelStatus === 'done' && (
                            <>
                                {error ? (
                                    <>
                                        <div className="ai-tool-error">{error}</div>
                                        {renameResults.length > 0 && (
                                            <>
                                                <p className="ai-rename-hint">Suggested names (not saved):</p>
                                                <ul className="ai-rename-results">
                                                    {renameResults.map((r) => (
                                                        <li key={r.uid} className="ai-rename-result-row">
                                                            <span className="ai-rename-old">{r.oldName}</span>
                                                            <span className="ai-rename-arrow">→</span>
                                                            <span className="ai-rename-new">{r.newName}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </>
                                        )}
                                        {wasCancelled && (
                                            <p className="ai-rename-hint">Cancelled — no changes were saved.</p>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        {renameResults.length > 0 && (
                                            <ul className="ai-rename-results">
                                                {renameResults.map((r) => (
                                                    <li key={r.uid} className="ai-rename-result-row">
                                                        <span className="ai-rename-old">{r.oldName}</span>
                                                        <span className="ai-rename-arrow">→</span>
                                                        <span className="ai-rename-new">{r.newName}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {skipped.length > 0 && (
                                            <p className="ai-rename-skipped">{skipped.length} skipped</p>
                                        )}
                                        {wasCancelled && renameResults.length === 0 && (
                                            <p className="ai-rename-hint">Cancelled — no changes made.</p>
                                        )}
                                        {wasCancelled && renameResults.length > 0 && (
                                            <p className="ai-rename-hint">Cancelled — partial results applied above.</p>
                                        )}
                                    </>
                                )}
                                <button
                                    type="button"
                                    className="ai-tool-action-btn"
                                    onClick={close}
                                >
                                    Done
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}

export default AIToolsModal;
