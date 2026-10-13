import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MdRefresh } from 'react-icons/md';
import hubCore from '../../chrome/ai-hub-core';
import { hasTabGroups } from '../utils/platform';

// Suggestions follow the conversation's topic. Planning: only refinements of
// the current plan (AI follow-ups from the last turn, with generic fallbacks).
// Conversational (clarify / find-tab): the router's follow-ups for that reply.
// Library maintenance: only the neighbouring grounded maintenance actions —
// never trip ideas, and never maintenance chores inside a planning session.
export function buildHubSuggestions({ collections = [], scope, activeTool, followUps = [] } = {}) {
    if (activeTool === 'task-planner') {
        const fromTurn = (followUps || []).filter(Boolean).map(label => ({ id: `follow:${label}`, label, reason: 'Refine the current plan.' }));
        return fromTurn.length ? fromTurn : [
            { id: 'refine', label: 'Find more useful resources', reason: 'Expand the current plan.' },
            { id: 'focus', label: 'Focus on beginner-friendly resources', reason: 'Refine the current plan.' },
        ];
    }
    // Conversational replies (a clarifying question, a tab search) follow the
    // chat: only the router's follow-ups for that reply, or nothing at all —
    // never off-topic maintenance chores under an unrelated question.
    if (hubCore.CONVERSATIONAL_TOOLS.includes(activeTool)) {
        return (followUps || []).filter(Boolean).map(label => ({ id: `follow:${label}`, label, reason: 'Continue the conversation.' }));
    }
    const grounded = hubCore.buildSuggestions(collections, scope);
    const groupTabs = hasTabGroups() ? [{ id: 'group', tool: 'smart-organize', label: 'Group open tabs', reason: 'Choose a browser window to organize.' }] : [];
    const maintenance = [...grounded, ...groupTabs]
        .filter(s => s.tool !== activeTool);
    return maintenance.length ? maintenance : [{ id: 'plan', tool: 'task-planner', label: 'Plan something new', reason: 'Gather websites for a task.' }];
}

export default function AIHubSuggestions({ collections, scope, activeTool, followUps, disabled, onSelect, onRefresh, limit = 3, quiet = false }) {
    const [page, setPage] = useState(0);
    const pillsRef = useRef(null);
    const positionsRef = useRef(new Map());
    const suggestions = useMemo(() => buildHubSuggestions({ collections, scope, activeTool, followUps }), [collections, scope, activeTool, followUps]);
    const visible = suggestions.length ? Array.from({ length: Math.min(limit, suggestions.length) }, (_, i) => suggestions[(page * limit + i) % suggestions.length]) : [];
    // Keep surviving pills spatially connected when a completed task removes
    // an obsolete suggestion. FLIP uses transforms, not animated layout sizes.
    const visibleKey = visible.map(s => s.id).join('|');
    useLayoutEffect(() => {
        const nodes = Array.from(pillsRef.current?.children || []);
        const next = new Map(nodes.map(node => [node.dataset.suggestion, node.getBoundingClientRect()]));
        const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
        const reduced = document.documentElement.classList.contains('performance-mode') || media?.matches;
        const animations = [];
        if (!reduced) nodes.forEach(node => {
            const before = positionsRef.current.get(node.dataset.suggestion);
            const after = next.get(node.dataset.suggestion);
            if (before && typeof node.animate === 'function' && (before.x !== after.x || before.y !== after.y)) {
                animations.push(node.animate([{ transform: `translate(${before.x - after.x}px, ${before.y - after.y}px)` }, { transform: 'translate(0, 0)' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' }));
            }
        });
        positionsRef.current = next;
        const cancel = () => animations.forEach(animation => animation.cancel());
        const onMotionChange = () => { if (media.matches) cancel(); };
        media?.addEventListener?.('change', onMotionChange);
        return () => { cancel(); media?.removeEventListener?.('change', onMotionChange); };
    }, [visibleKey]);
    if (!visible.length) return null;
    return (
        <div className="ai-hub-suggestions" aria-label="Suggested next actions">
            {!quiet && <div className="ai-hub-suggestions-label"><span>{disabled ? 'Ideas for your next step' : 'A few ideas for you'}</span>
                <button type="button" className="tp-pills-refresh" aria-label="New suggestions" disabled={disabled}
                    data-tooltip-id="main-tooltip" data-tooltip-content="Show more ideas"
                    onClick={() => { setPage(p => p + 1); onRefresh?.(); }}><MdRefresh size={16} /></button>
            </div>}
            <div className="tp-pills" ref={pillsRef}>
                {visible.map((suggestion, i) => <button key={suggestion.id} type="button" className="tp-pill ai-hub-pill"
                    data-suggestion={suggestion.id}
                    style={{ animationDelay: `${i * 35}ms` }} disabled={disabled}
                    data-tooltip-id="main-tooltip" data-tooltip-content={suggestion.reason}
                    onClick={() => onSelect(suggestion)}>{suggestion.label}</button>)}
            </div>
        </div>
    );
}
