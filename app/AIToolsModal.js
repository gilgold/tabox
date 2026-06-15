import React, { useCallback, useEffect, useRef, useState } from 'react';
import Modal from 'react-modal';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { MdClose, MdArrowBack, MdUndo } from 'react-icons/md';
import { BsStars } from 'react-icons/bs';
import { aiToolsModalOpenState, aiToolsScopeState, aiProcessingUidsState, aiProcessingCurrentUidState } from './atoms/aiState';
import { viewContextState } from './atoms/globalAppSettingsState';
import { AI_TOOLS } from './ai/aiTasks';
import { getAIAvailability } from './ai/aiClient';
import { readWindowStructure } from './ai/readWindowStructure';
import { loadAllCollections } from './utils/storageUtils';
import { buildCollectionFromSnapshot } from './utils/saveCollectionSnapshot';
import { captureWindowSnapshot } from './ai/captureWindowSnapshot';
import { useSmartOrganizeUndo } from './ai/useSmartOrganizeUndo';
import { useAutoArrangeUndo } from './ai/useAutoArrangeUndo';
import AutoArrangeFoldAnimation from './AutoArrangeFoldAnimation';
import SmartOrganizeFoldAnimation from './SmartOrganizeFoldAnimation';
import { showUndoToast, showSuccessToast } from './toastHelpers';
import { UNDO_TIME } from './constants';
import { browser } from '../static/globals';
import './Modal.css';
import './AIToolsModal.css';

// Map a service-worker aiTaskState.type to the modal's activeToolId, so a
// reopened popup can auto-navigate to the running task's panel.
const TASK_TO_TOOL = {
    'auto-rename': 'auto-rename',
    'auto-arrange': 'auto-arrange-folders',
    'smart-organize': 'smart-organize',
};

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
    // uids whose per-row undo is in flight (button disabled until the SW writes back)
    const [revertingUids, setRevertingUids] = useState([]);

    // Shared service-worker AI task state. The SW owns task execution and writes
    // progress/results to chrome.storage.local under `aiTaskState`; the popup
    // observes it so a reopened popup re-attaches to an in-progress run. Reused
    // by Auto-Rename now and Auto-Arrange / Smart-Organize next.
    const [aiTaskState, setAiTaskState] = useState(null);
    // Tracks the taskId we've already finalized (toast shown for rename/arrange;
    // plan applied for smart-organize) so a re-render or duplicate done-event
    // can't double-fire.
    const completedTaskIdRef = useRef(null);

    // Smart Organize panel state
    const [soWindowId, setSoWindowId] = useState(null);
    const [soStructure, setSoStructure] = useState(null); // { ungroupedTabs, existingGroups }
    const [soSummary, setSoSummary] = useState(null); // string
    const [soWindows, setSoWindows] = useState([]); // for full-page picker
    const [soLoadingWindows, setSoLoadingWindows] = useState(false);

    // Persistent Smart Organize undo snapshot (survives popup close)
    const { snapshot: soUndoSnapshot, undo: soUndoLast } = useSmartOrganizeUndo();

    // Auto-Arrange panel state
    const [aaSummary, setAaSummary] = useState(null);
    // Auto-Arrange determinate progress: collections filed (paced) of total.
    const [aaFiled, setAaFiled] = useState(0);
    const [aaTotal, setAaTotal] = useState(0);
    const aaTickRef = useRef(null);
    const { snapshot: aaUndoSnapshot } = useAutoArrangeUndo();

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
        // Reset Smart Organize panel state
        setSoWindowId(null);
        setSoStructure(null);
        setSoSummary(null);
        setSoWindows([]);
        setSoLoadingWindows(false);
        setAaSummary(null);
        setAaFiled(0);
        setAaTotal(0);
        stopAaTicker();
        // Drop any prior task state + toast guard so a stale terminal run from a
        // previous session can't clobber the freshly-reset idle panel on reopen.
        setAiTaskState(null);
        completedTaskIdRef.current = null;
        loadAllCollections().then(setCollections).catch((loadError) => {
            console.error('Tabox AI: failed to load collections', loadError);
            setCollections([]);
        });
        // Warm the on-device model so the first AI task starts faster. Fire-and-forget;
        // the SW creates+destroys a throwaway session to load the model into memory.
        browser.runtime.sendMessage({ type: 'aiWarmup' }).catch(() => {});
    }, [isOpen, setAiProcessingUids, setAiProcessingCurrentUid]);

    // Abort on unmount and clear AI processing atoms
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            if (aaTickRef.current) {
                clearInterval(aaTickRef.current);
                aaTickRef.current = null;
            }
            setAiProcessingUids([]);
            setAiProcessingCurrentUid(null);
        };
    }, [setAiProcessingUids, setAiProcessingCurrentUid]);

    // ── Shared service-worker plumbing ──────────────────────────────────────
    // Fire an AI task in the service worker. Returns the promise resolving to the
    // final aiTaskState; live progress comes via the storage subscription below.
    const dispatchAiRun = useCallback((task, params) => browser.runtime.sendMessage({ type: 'aiRun', task, params }), []);
    const sendAiCancel = useCallback(() => browser.runtime.sendMessage({ type: 'aiCancel' }), []);
    const sendAiUndo = useCallback(() => browser.runtime.sendMessage({ type: 'aiUndo' }), []);
    const sendAiUndoItems = useCallback((uids) => browser.runtime.sendMessage({ type: 'aiUndoItems', uids }), []);

    // Subscribe to aiTaskState: read once on open, then track storage changes so
    // a reopened popup re-attaches to an in-progress run.
    useEffect(() => {
        if (!isOpen) return undefined;
        let cancelled = false;
        // Only REATTACH to an actively-running task on open. A terminal
        // (done/cancelled/error) initial state is stale from a prior session and
        // must not overwrite the idle panel or re-fire the completion toast — the
        // live storage.onChanged listener below still adopts changes, so a run
        // that completes while the popup is open drives the done panel + toast.
        (async () => {
            try {
                const initial = await browser.runtime.sendMessage({ type: 'aiGetState' });
                if (!cancelled && initial && initial.status === 'running') {
                    setAiTaskState(initial);
                    // Reopen mid-run: auto-navigate to the running task's panel so
                    // the user immediately sees the in-progress run instead of the
                    // tool hub. Only on the initial (reattach) fetch and only while
                    // no tool is selected yet, to avoid overriding user navigation.
                    const toolId = TASK_TO_TOOL[initial.type];
                    if (toolId && !activeToolId) {
                        setActiveToolId(toolId);
                        setPanelStatus('running');
                    }
                }
            } catch {
                // No reachable SW state — leave the panel idle.
            }
        })();

        const onChanged = (changes, area) => {
            if (area !== 'local' || !changes.aiTaskState) return;
            setAiTaskState(changes.aiTaskState.newValue || null);
        };
        browser.storage.onChanged.addListener(onChanged);
        return () => {
            cancelled = true;
            browser.storage.onChanged.removeListener(onChanged);
        };
    }, [isOpen]);

    const busy = panelStatus === 'running';
    const close = () => setIsOpen(false);

    // uids still undoable on the done panel — the live undo snapshot the SW maintains.
    const renameUndoUids = (aiTaskState && aiTaskState.type === 'auto-rename' && aiTaskState.undo && aiTaskState.undo.renames)
        ? aiTaskState.undo.renames.map((r) => r.uid)
        : [];

    const handleUndoItem = (uid) => {
        setRevertingUids((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
        sendAiUndoItems([uid]);
    };

    const handleUndoAll = () => {
        if (renameUndoUids.length === 0) return;
        setRevertingUids((prev) => Array.from(new Set([...prev, ...renameUndoUids])));
        sendAiUndoItems(renameUndoUids);
    };

    // Collections that have tabs (can be renamed by AI)
    const nameableCollections = collections.filter((c) => (c.tabs || []).length > 0);

    // Apply scope filter
    const targets = scope.type === 'selected'
        ? nameableCollections.filter((c) => scope.uids.includes(c.uid))
        : nameableCollections;

    // Auto-Arrange operates on root (loose) collections only.
    const rootCollections = collections.filter((c) => (c.parentId ?? null) === null);

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

        // Reset local UI; the service worker now owns execution, apply, and undo.
        setPanelStatus('running');
        setRenameResults([]);
        setSkipped([]);
        setWasCancelled(false);
        setError(null);
        setIsCancelling(false);
        setProgressLabel('');
        setProgressFill(0);
        setRevertingUids([]);
        setAiProcessingUids(targets.map((t) => t.uid));

        // Allow a fresh completion toast for the run we're about to start.
        completedTaskIdRef.current = null;

        // Fire-and-forget; live progress + results arrive via the aiTaskState
        // storage subscription. (We don't await the final state — the storage
        // subscription is the source of truth.)
        dispatchAiRun('auto-rename', { uids: targets.map((t) => t.uid) }).catch((runError) => {
            console.error('Tabox AI: aiRun(auto-rename) dispatch failed:', runError);
            setAiProcessingUids([]);
            setAiProcessingCurrentUid(null);
            setError('An unexpected error occurred. Please try again.');
            setPanelStatus('done');
            runStartedRef.current = false;
        });
    };

    // Drive the Auto-Rename panel UI from the service-worker-owned aiTaskState.
    useEffect(() => {
        if (activeToolId !== 'auto-rename') return;
        if (!aiTaskState || aiTaskState.type !== 'auto-rename') return;

        const { status, filed = 0, total = 0, currentLabel, currentUid, results = [], skipped: skippedList = [], summary, undo } = aiTaskState;

        if (status === 'running') {
            setPanelStatus('running');
            setProgressLabel(total ? `Renaming ${filed + 1} of ${total}: ${currentLabel || ''}` : 'Renaming collections with AI…');
            setProgressFill(total ? Math.round((filed / total) * 100) : 0);
            setAiProcessingCurrentUid(currentUid || null);
            setRenameResults(results);
            setSkipped(skippedList);
            return;
        }

        if (status === 'done' || status === 'cancelled' || status === 'error') {
            setRenameResults(results);
            const undoUids = (undo && undo.renames ? undo.renames : []).map((r) => r.uid);
            setRevertingUids((prev) => prev.filter((u) => undoUids.includes(u)));
            setSkipped(skippedList);
            setAiProcessingUids([]);
            setAiProcessingCurrentUid(null);
            setWasCancelled(status === 'cancelled');
            setIsCancelling(false);
            runStartedRef.current = false;

            if (status === 'error') {
                setError('An unexpected error occurred. Please try again.');
                setPanelStatus('done');
                return;
            }

            setError(null);
            setPanelStatus('done');

            // Fire the undo toast once per finished run with renames applied.
            if (status === 'done' && results.length > 0 && completedTaskIdRef.current !== aiTaskState.taskId) {
                completedTaskIdRef.current = aiTaskState.taskId;
                showUndoToast(
                    <BsStars />,
                    summary || `Renamed ${results.length} collection${results.length === 1 ? '' : 's'} with AI`,
                    'Tabox AI',
                    () => sendAiUndo(),
                    UNDO_TIME,
                );
            }
        }
    }, [aiTaskState, activeToolId, setAiProcessingUids, setAiProcessingCurrentUid, sendAiUndo]);

    const handleCancel = () => {
        if (!busy || isCancelling) return;
        setIsCancelling(true);
        sendAiCancel();
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    // When entering the smart-organize panel, resolve the target window and read its structure.
    useEffect(() => {
        if (activeToolId !== 'smart-organize') return;
        let cancelled = false;

        const loadPopupWindow = async () => {
            try {
                const win = await browser.windows.getCurrent();
                if (cancelled) return;
                setSoWindowId(win.id);
                const structure = await readWindowStructure(win.id);
                if (cancelled) return;
                setSoStructure(structure);
            } catch (e) {
                console.error('Smart Organize: failed to read current window', e);
            }
        };

        const loadFullPageWindows = async () => {
            setSoLoadingWindows(true);
            try {
                const allWins = await browser.windows.getAll({ populate: true });
                if (cancelled) return;
                const withStructure = await Promise.all(
                    allWins.map(async (win) => {
                        const structure = await readWindowStructure(win.id);
                        const activeTab = (win.tabs || []).find((t) => t.active);
                        const label = `${activeTab?.title || 'Window'} (+${(win.tabs || []).length} tabs)`;
                        return { id: win.id, label, ungroupedCount: structure.eligibleCount, structure };
                    })
                );
                if (cancelled) return;
                setSoWindows(withStructure);
            } catch (e) {
                console.error('Smart Organize: failed to load windows', e);
            } finally {
                if (!cancelled) setSoLoadingWindows(false);
            }
        };

        if (viewContext !== 'fullpage') {
            loadPopupWindow();
        } else {
            loadFullPageWindows();
        }

        return () => { cancelled = true; };
    }, [activeToolId, viewContext]);

    const handleSmartOrganizeSelectWindow = async (win) => {
        setSoWindowId(win.id);
        setSoStructure(win.structure);
    };

    // Re-read the target window structure and reset to idle (used after undo)
    const reloadWindowAndGoIdle = async (windowId) => {
        setSoSummary(null);
        setPanelStatus('idle');
        if (!windowId) return;
        try {
            const token = runTokenRef.current;
            const structure = await readWindowStructure(windowId);
            if (token !== runTokenRef.current) return;
            setSoStructure(structure);
        } catch (e) {
            console.error('Smart Organize: failed to re-read window after undo', e);
        }
    };

    const handleSmartOrganizeUndoLast = async () => {
        const windowId = soUndoSnapshot?.windowId ?? soWindowId;
        await soUndoLast();
        await reloadWindowAndGoIdle(windowId);
    };

    const handleSmartOrganizeRun = async () => {
        if (panelStatus !== 'idle') return;
        if (runStartedRef.current) return;
        runStartedRef.current = true;

        // Pre-flight check
        const availability = await getAIAvailability();
        if (availability !== 'available') {
            runStartedRef.current = false;
            setError('Tabox AI is not ready on this device. Check the Tabox AI setting.');
            return;
        }

        // Allow a fresh apply/toast for the run we're about to start.
        completedTaskIdRef.current = null;

        setPanelStatus('running');
        setError(null);
        setSoSummary(null);

        // Planning only — the SW reads the window, calls the AI, and writes the
        // plan to aiTaskState. The aiTaskState→UI effect applies it on 'done'.
        dispatchAiRun('smart-organize', { windowId: soWindowId }).catch((runError) => {
            console.error('Tabox AI: aiRun(smart-organize) dispatch failed:', runError);
            setError('An unexpected error occurred. Please try again.');
            setPanelStatus('idle');
            runStartedRef.current = false;
        });
    };

    // Drive the Smart-Organize panel UI from the service-worker-owned aiTaskState.
    // The SW does planning only; this effect applies the plan (via the existing
    // smartOrganizeApply message) when it observes the plan is done.
    useEffect(() => {
        if (activeToolId !== 'smart-organize') return undefined;
        if (!aiTaskState || aiTaskState.type !== 'smart-organize') return undefined;

        const { status, results, taskId } = aiTaskState;

        if (status === 'running') {
            setPanelStatus('running');
            return undefined;
        }

        if (status === 'cancelled') {
            setPanelStatus('idle');
            runStartedRef.current = false;
            return undefined;
        }

        if (status === 'error') {
            setError('An unexpected error occurred. Please try again.');
            setPanelStatus('idle');
            runStartedRef.current = false;
            return undefined;
        }

        if (status === 'done' && results) {
            // Apply is async; guard once-per-taskId BEFORE awaiting so a React
            // re-render can't re-enter and double-apply the same plan.
            if (completedTaskIdRef.current === taskId) return undefined;
            // The window must be resolved before we can apply; the effect re-runs
            // when soWindowId lands (it's in deps).
            if (!soWindowId) return undefined;
            completedTaskIdRef.current = taskId;

            // Guard the async apply against unmount / isOpen flip: if this effect
            // tears down mid-apply, skip the post-await setState calls.
            let dead = false;

            (async () => {
                let applyResult;
                try {
                    applyResult = await browser.runtime.sendMessage({
                        type: 'smartOrganizeApply',
                        windowId: soWindowId,
                        plan: results,
                        createdAt: Date.now(),
                    });
                } catch (applyError) {
                    if (dead) return;
                    console.error('Smart Organize: apply failed:', applyError);
                    setError('Could not apply the grouping. Please try again.');
                    setPanelStatus('idle');
                    runStartedRef.current = false;
                    return;
                }

                if (dead) return;

                const { groupsCreated = 0, tabsAdded = 0, skipped: skippedCount = 0 } = applyResult || {};
                const summary = `Created ${groupsCreated} groups · added ${tabsAdded} tabs to existing groups · ${skippedCount} left ungrouped`;
                setSoSummary(summary);

                showUndoToast(
                    <BsStars />,
                    'Organized tabs into groups',
                    'Smart Organize',
                    () => browser.runtime.sendMessage({ type: 'smartOrganizeUndo', windowId: soWindowId }),
                    UNDO_TIME,
                );

                setPanelStatus('done');
                runStartedRef.current = false;
            })();

            return () => { dead = true; };
        }

        return undefined;
    }, [aiTaskState, activeToolId, soWindowId]);

    const handleSmartOrganizeSaveAsCollection = async () => {
        try {
            // Capture the full window (all non-fullpage tabs with groupIds + real group objects)
            // for both popup and full-page contexts, keyed by the resolved soWindowId.
            const snapshot = await captureWindowSnapshot(soWindowId);
            const newCollection = buildCollectionFromSnapshot({ snapshot, name: 'Smart Organize' });
            const all = await loadAllCollections();
            await updateRemoteData([...all, newCollection]);
            showSuccessToast('Collection saved!');
            close();
        } catch (e) {
            console.error('Smart Organize: save as collection failed:', e);
            setError('Could not save the collection. Please try again.');
        }
    };

    const stopAaTicker = () => {
        if (aaTickRef.current) {
            clearInterval(aaTickRef.current);
            aaTickRef.current = null;
        }
    };

    const handleAutoArrangeRun = async () => {
        if (panelStatus !== 'idle' || rootCollections.length === 0) return;
        if (runStartedRef.current) return;
        runStartedRef.current = true;

        const availability = await getAIAvailability();
        if (availability !== 'available') {
            runStartedRef.current = false;
            setError('Tabox AI is not ready on this device. Check the Tabox AI setting.');
            return;
        }

        setPanelStatus('running');
        setError(null);
        setIsCancelling(false);
        setAaSummary(null);

        // Paced determinate progress: tick the filed count up toward the total
        // while the single SW plan + batch apply run. Held one short of the total
        // until the real result lands, then snapped to the moved count by the
        // aiTaskState→UI effect on completion.
        const total = rootCollections.length;
        setAaTotal(total);
        setAaFiled(0);
        // Allow a fresh completion toast for the run we're about to start.
        completedTaskIdRef.current = null;
        stopAaTicker();
        aaTickRef.current = setInterval(() => {
            setAaFiled((prev) => (prev < total - 1 ? prev + 1 : prev));
        }, 700);

        // Fire-and-forget; the SW plans, creates folders, moves collections,
        // stores the undo snapshot, and syncs. Live progress + the final result
        // arrive via the aiTaskState storage subscription, and App auto-refreshes
        // the list on the collections/folders index change.
        dispatchAiRun('auto-arrange', {}).catch((runError) => {
            stopAaTicker();
            console.error('Tabox AI: aiRun(auto-arrange) dispatch failed:', runError);
            setError('An unexpected error occurred. Please try again.');
            setPanelStatus('idle');
            runStartedRef.current = false;
        });
    };

    // Drive the Auto-Arrange panel UI from the service-worker-owned aiTaskState.
    useEffect(() => {
        if (activeToolId !== 'auto-arrange-folders') return;
        if (!aiTaskState || aiTaskState.type !== 'auto-arrange') return;

        const { status, filed = 0, total, summary } = aiTaskState;

        if (status === 'running') {
            setPanelStatus('running');
            // Leave the paced ticker running; only adopt a real total if present.
            if (total) setAaTotal(total);
            return;
        }

        if (status === 'done' || status === 'cancelled' || status === 'error') {
            stopAaTicker();
            setIsCancelling(false);
            runStartedRef.current = false;

            if (status === 'error') {
                setError('Could not arrange the collections. Please try again.');
                setPanelStatus('idle');
                return;
            }
            if (status === 'cancelled') {
                // Auto-Arrange has no partial-results panel — return to idle.
                setPanelStatus('idle');
                return;
            }

            // status === 'done'
            setError(null);
            setAaFiled(filed);
            setAaSummary(summary);
            setPanelStatus('done');

            // Fire the undo toast once per finished run.
            if (completedTaskIdRef.current !== aiTaskState.taskId) {
                completedTaskIdRef.current = aiTaskState.taskId;
                showUndoToast(
                    <BsStars />,
                    'Arranged collections into folders',
                    'Tabox AI',
                    () => sendAiUndo(),
                    UNDO_TIME,
                );
            }
        }
    }, [aiTaskState, activeToolId, sendAiUndo]);

    const handleAutoArrangeUndo = async () => {
        await sendAiUndo();
        setAaSummary(null);
        setPanelStatus('idle');
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
                                    <ToolIcon size={26} className="ai-hero-icon" />
                                    <span className="ai-hero-title">{tool.title}</span>
                                    <span className="ai-hero-description">{tool.description}</span>
                                </button>
                            );
                        })}
                        <div className="ai-tools-grid">
                            {AI_TOOLS.filter((t) => !t.featured).map((tool) => {
                                const ToolIcon = tool.icon;
                                const disabled = tool.id === 'auto-arrange-folders' && rootCollections.length === 0;
                                return (
                                    <button
                                        key={tool.id}
                                        type="button"
                                        className="ai-tool-card"
                                        onClick={() => setActiveToolId(tool.id)}
                                        disabled={disabled}
                                        title={disabled ? 'No collections at the top level to arrange' : undefined}
                                    >
                                        <ToolIcon size={22} className="ai-tool-card-icon" />
                                        <span className="ai-tool-card-title">{tool.title}</span>
                                        <span className="ai-tool-card-description">{tool.description}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {activeToolId === 'smart-organize' && (
                    <div className="ai-tool-panel">
                        {/* Full-page window picker */}
                        {viewContext === 'fullpage' && !soWindowId && (
                            <div className="ai-so-window-picker">
                                {soLoadingWindows ? (
                                    <p className="ai-rename-hint">Loading windows…</p>
                                ) : (
                                    <>
                                        <p className="ai-rename-description">Choose a window to organize:</p>
                                        <ul className="ai-so-window-list">
                                            {soWindows.map((win) => (
                                                <li key={win.id}>
                                                    <button
                                                        type="button"
                                                        className="ai-so-window-item"
                                                        onClick={() => handleSmartOrganizeSelectWindow(win)}
                                                    >
                                                        <span className="ai-so-window-label">{win.label}</span>
                                                        <span className="ai-so-window-ungrouped">
                                                            {win.ungroupedCount} ungrouped
                                                        </span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Idle state */}
                        {panelStatus === 'idle' && soStructure && (
                            <>
                                {soStructure.eligibleCount === 0 ? (
                                    <p className="ai-rename-hint">Everything here is already grouped.</p>
                                ) : (
                                    <p className="ai-rename-description">
                                        Organize {soStructure.eligibleCount} ungrouped tabs in this window using AI.
                                    </p>
                                )}
                                {error && <div className="ai-tool-error">{error}</div>}
                                <button
                                    type="button"
                                    className="ai-tool-action-btn"
                                    onClick={handleSmartOrganizeRun}
                                    disabled={soStructure.eligibleCount === 0}
                                    aria-label={`Organize ${soStructure.eligibleCount} ungrouped tabs`}
                                >
                                    <BsStars size={14} style={{ marginRight: '6px' }} />
                                    Organize now
                                </button>
                                {soUndoSnapshot && (
                                    <div className="ai-so-undo-row">
                                        <button
                                            type="button"
                                            className="ai-so-undo-btn"
                                            onClick={handleSmartOrganizeUndoLast}
                                        >
                                            ↩ Undo last organize
                                        </button>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Running state */}
                        {panelStatus === 'running' && (
                            <>
                                <SmartOrganizeFoldAnimation />
                                <div className="ai-rename-progress">
                                    <div className="ai-rename-progress-track">
                                        <div className="ai-rename-progress-fill ai-rename-progress-fill--animated" />
                                    </div>
                                    <span className="ai-rename-progress-label">Organizing tabs…</span>
                                </div>
                                <button
                                    type="button"
                                    className="ai-tool-action-btn ai-tool-action-btn--cancel"
                                    onClick={handleCancel}
                                >
                                    Cancel
                                </button>
                            </>
                        )}

                        {/* Done state */}
                        {panelStatus === 'done' && (
                            <>
                                {error && <div className="ai-tool-error">{error}</div>}
                                {soSummary && (
                                    <p className="ai-rename-description ai-so-summary">{soSummary}</p>
                                )}
                                <div className="ai-so-done-actions">
                                    <button
                                        type="button"
                                        className="ai-tool-action-btn"
                                        onClick={handleSmartOrganizeSaveAsCollection}
                                    >
                                        Save as collection
                                    </button>
                                    <button
                                        type="button"
                                        className="ai-tool-action-btn ai-tool-action-btn--cancel"
                                        onClick={handleSmartOrganizeUndoLast}
                                    >
                                        Undo
                                    </button>
                                    <button
                                        type="button"
                                        className="ai-tool-action-btn ai-tool-action-btn--cancel"
                                        onClick={close}
                                    >
                                        Close
                                    </button>
                                </div>
                            </>
                        )}
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
                                                    <li
                                                        key={r.uid}
                                                        className={`ai-rename-result-row${r.reverted ? ' ai-rename-result-row--reverted' : ''}`}
                                                    >
                                                        <span className="ai-rename-old">{r.oldName}</span>
                                                        <span className="ai-rename-arrow">→</span>
                                                        <span className="ai-rename-new">{r.newName}</span>
                                                        {r.reverted ? (
                                                            <span className="ai-rename-reverted-tag">reverted</span>
                                                        ) : renameUndoUids.includes(r.uid) ? (
                                                            <button
                                                                type="button"
                                                                className="ai-rename-undo-btn"
                                                                onClick={() => handleUndoItem(r.uid)}
                                                                disabled={revertingUids.length > 0}
                                                                aria-label={`Undo rename of ${r.newName}`}
                                                                title="Undo this rename"
                                                            >
                                                                <MdUndo size={15} />
                                                            </button>
                                                        ) : null}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {skipped.length > 0 && (
                                            <p className="ai-rename-skipped">{skipped.length} skipped</p>
                                        )}
                                        {!wasCancelled && renameResults.length === 0 && (
                                            <p className="ai-rename-hint">
                                                {skipped.length > 0
                                                    ? 'No names were changed.'
                                                    : 'No changes needed — your collections already have clear names.'}
                                            </p>
                                        )}
                                        {wasCancelled && renameResults.length === 0 && (
                                            <p className="ai-rename-hint">Cancelled — no changes made.</p>
                                        )}
                                        {wasCancelled && renameResults.length > 0 && (
                                            <p className="ai-rename-hint">Cancelled — partial results applied above.</p>
                                        )}
                                        {renameUndoUids.length > 0 ? (
                                            <button
                                                type="button"
                                                className="ai-tool-action-btn ai-tool-action-btn--cancel ai-rename-undo-all"
                                                onClick={handleUndoAll}
                                                disabled={revertingUids.length > 0}
                                            >
                                                <MdUndo size={15} style={{ marginRight: '6px' }} />
                                                Undo all
                                            </button>
                                        ) : renameResults.some((r) => r.reverted) ? (
                                            <p className="ai-rename-hint">All renames reverted.</p>
                                        ) : null}
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

                {activeToolId === 'auto-arrange-folders' && (
                    <div className="ai-tool-panel">
                        {panelStatus === 'idle' && (
                            <>
                                <p className="ai-rename-description">
                                    This will move all your loose collections into folders — using your existing folders and creating new ones where needed.
                                </p>
                                {rootCollections.length === 0 && (
                                    <p className="ai-rename-hint">No collections at the top level to arrange.</p>
                                )}
                                {error && <div className="ai-tool-error">{error}</div>}
                                <button
                                    type="button"
                                    className="ai-tool-action-btn"
                                    onClick={handleAutoArrangeRun}
                                    disabled={rootCollections.length === 0}
                                >
                                    <BsStars size={14} style={{ marginRight: '6px' }} />
                                    Arrange now
                                </button>
                                {aaUndoSnapshot && (
                                    <div className="ai-so-undo-row">
                                        <button type="button" className="ai-so-undo-btn" onClick={handleAutoArrangeUndo}>
                                            ↩ Undo last arrange
                                        </button>
                                    </div>
                                )}
                            </>
                        )}

                        {panelStatus === 'running' && (
                            <>
                                <AutoArrangeFoldAnimation />
                                <div className="ai-rename-progress">
                                    <div className="ai-rename-progress-track">
                                        <div
                                            className="ai-rename-progress-fill"
                                            style={{ width: `${aaTotal ? Math.round((aaFiled / aaTotal) * 100) : 0}%` }}
                                        />
                                    </div>
                                    <span className="ai-rename-progress-label">
                                        {aaTotal
                                            ? `Filing ${aaFiled} of ${aaTotal} collection${aaTotal === 1 ? '' : 's'}…`
                                            : 'Arranging collections…'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="ai-tool-action-btn ai-tool-action-btn--cancel"
                                    onClick={handleCancel}
                                >
                                    Cancel
                                </button>
                            </>
                        )}

                        {panelStatus === 'done' && (
                            <>
                                {error && <div className="ai-tool-error">{error}</div>}
                                {aaSummary && <p className="ai-rename-description ai-so-summary">{aaSummary}</p>}
                                <div className="ai-so-done-actions">
                                    <button
                                        type="button"
                                        className="ai-tool-action-btn ai-tool-action-btn--cancel"
                                        onClick={handleAutoArrangeUndo}
                                    >
                                        Undo
                                    </button>
                                    <button type="button" className="ai-tool-action-btn ai-tool-action-btn--cancel" onClick={close}>
                                        Close
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
                <p className="ai-tools-disclaimer">AI makes mistakes. Always review suggestions before applying them.</p>
            </div>
        </Modal>
    );
}

export default AIToolsModal;
