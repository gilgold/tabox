import React, { useEffect, useRef, useState } from 'react';
import Modal from 'react-modal';
import { useAtom, useAtomValue } from 'jotai';
import { MdClose, MdArrowBack } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { aiToolsModalOpenState, aiToolsScopeState } from './atoms/aiState';
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
    const [activeToolId, setActiveToolId] = useState(null);
    const [collections, setCollections] = useState([]);
    // Panel state machine: idle | running | done
    const [panelStatus, setPanelStatus] = useState('idle');
    const [renameResults, setRenameResults] = useState([]); // live list of {uid, oldName, newName} | {uid, reason}
    const [skipped, setSkipped] = useState([]);
    const [wasCancelled, setWasCancelled] = useState(false);
    const [error, setError] = useState(null);
    const [isCancelling, setIsCancelling] = useState(false);
    // Fix 4: progress tracking
    const [progressLabel, setProgressLabel] = useState('');
    const [progressFill, setProgressFill] = useState(0); // 0–100

    // Abort controller for the running engine
    const abortControllerRef = useRef(null);
    // Run token to invalidate stale async state updates
    const runTokenRef = useRef(0);
    // Fix 1: synchronous re-entry guard — set before any await in handleRun
    const runStartedRef = useRef(false);

    useEffect(() => {
        if (!isOpen) return;
        // Abort any in-flight run from a previous session
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        runTokenRef.current += 1;
        runStartedRef.current = false;
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
    }, [isOpen]);

    // Abort on unmount
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

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
        // Fix 1: synchronous re-entry guard — prevent double-click from starting two runs
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

        const total = targets.length;

        let engineResult;
        try {
            engineResult = await autoRenameCollections({
                collections: targets,
                signal: controller.signal,
                // Fix 4: wire onProgress for i/N label and determinate bar
                onProgress: (index, _total, collection) => {
                    if (token !== runTokenRef.current) return;
                    setProgressLabel(`Renaming ${index + 1} of ${total}: ${collection.name}`);
                    setProgressFill(Math.round((index / total) * 100));
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
            setError('An unexpected error occurred. Please try again.');
            setPanelStatus('done');
            runStartedRef.current = false;
            return;
        }

        if (token !== runTokenRef.current) return;

        const { results, cancelled } = engineResult;
        setWasCancelled(cancelled);

        if (results.length > 0) {
            try {
                const fresh = await loadAllCollections();
                // Fix 3: build map from full result entries (uid → {oldName, newName})
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
                        // Fix 3: use 'in' operator and only revert if name still matches AI's newName
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
                                {/* Fix 4: determinate progress bar + i/N label */}
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
                                {/* Fix 2: honest error state — separate error path from success path */}
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
