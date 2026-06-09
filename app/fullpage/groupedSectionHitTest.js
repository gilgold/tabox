import {
    collectionDropKinds,
    getCollectionTargetSide,
    ROOT_LEVEL_SECTION_ID,
} from '../utils/collectionSectionDragEngine';

/**
 * Single-pass grouped-section hit testing for collection drag-over events.
 *
 * Consolidates what used to be three separate DOM scans per dragOver
 * (empty-section hit, grid nearest-card hit, list start/end band hit) into
 * one querySelectorAll pass that reads each body/card rect exactly once,
 * then evaluates targets in the same priority order as the old call sites:
 *
 *   1. Empty-section hit (both view modes, 18px hit slop) — beats everything.
 *   2. Grid mode: nearest non-active card by center distance (or sectionEmpty
 *      when the body has no eligible cards). Skipped entirely when
 *      `allowGridCollectionTarget` is false (the call site disables it when
 *      the base droppable target is already a collection).
 *   3. List mode: section start/end bands, plus the 32px-top/64px-bottom
 *      slack variant for empty bodies that the band scan also handled.
 */
export const resolveGroupedSectionTarget = ({
    point,
    viewMode,
    activeId,
    allowGridCollectionTarget = true,
}) => {
    if (!point || typeof document === 'undefined') {
        return null;
    }

    // Single DOM scan: read each section body rect and card rect exactly once.
    const sectionEntries = Array.from(document.querySelectorAll('[data-grouped-section-body-parent-id]'))
        .map((body) => {
            const rect = body.getBoundingClientRect();
            const rawParentId = body.getAttribute('data-grouped-section-body-parent-id');
            const cards = Array.from(body.querySelectorAll('[data-sortable-collection-id]'))
                .map((card) => ({
                    collectionId: card.getAttribute('data-sortable-collection-id'),
                    rect: card.getBoundingClientRect(),
                }))
                // Zero-size cards are invisible (hidden source card, collapsed
                // layout) and never participate in hit testing.
                .filter(({ rect: cardRect }) => cardRect.width > 0 && cardRect.height > 0);

            return {
                rect,
                parentId: rawParentId === ROOT_LEVEL_SECTION_ID ? null : rawParentId,
                cards,
            };
        });

    // Pass 1 — empty-section hit (both modes, 18px slop). Highest priority.
    for (const { rect, parentId, cards } of sectionEntries) {
        if (cards.length > 0) {
            continue;
        }

        const hitSlop = 18;
        if (
            point.x < rect.left - hitSlop ||
            point.x > rect.right + hitSlop ||
            point.y < rect.top - hitSlop ||
            point.y > rect.bottom + hitSlop
        ) {
            continue;
        }

        return {
            kind: collectionDropKinds.sectionEmpty,
            parentId,
        };
    }

    // Pass 2 (grid) — nearest non-active card within the hovered body.
    if (viewMode === 'grid') {
        if (!allowGridCollectionTarget) {
            return null;
        }

        for (const { rect, parentId, cards } of sectionEntries) {
            if (
                point.x < rect.left ||
                point.x > rect.right ||
                point.y < rect.top ||
                point.y > rect.bottom
            ) {
                continue;
            }

            const eligibleCards = cards.filter(({ collectionId }) => (
                collectionId &&
                collectionId !== activeId
            ));

            if (eligibleCards.length === 0) {
                return {
                    kind: collectionDropKinds.sectionEmpty,
                    parentId,
                };
            }

            const nearestCard = eligibleCards.reduce((closest, candidate) => {
                const candidateCenterX = candidate.rect.left + (candidate.rect.width / 2);
                const candidateCenterY = candidate.rect.top + (candidate.rect.height / 2);
                const candidateDistance = Math.hypot(point.x - candidateCenterX, point.y - candidateCenterY);

                if (!closest || candidateDistance < closest.distance) {
                    return {
                        collectionId: candidate.collectionId,
                        rect: candidate.rect,
                        distance: candidateDistance,
                    };
                }

                return closest;
            }, null);

            if (!nearestCard) {
                return null;
            }

            return {
                kind: collectionDropKinds.collection,
                parentId,
                collectionId: nearestCard.collectionId,
                side: getCollectionTargetSide({
                    viewMode: 'grid',
                    point,
                    rect: nearestCard.rect,
                }),
            };
        }

        return null;
    }

    // Pass 2 (list) — start/end bands, plus the wider empty-body slack.
    if (viewMode !== 'list') {
        return null;
    }

    for (const { rect, parentId, cards } of sectionEntries) {
        if (cards.length === 0) {
            const emptySectionTopSlack = 32;
            const emptySectionBottomSlack = 64;
            if (
                point.x < rect.left ||
                point.x > rect.right ||
                point.y < rect.top - emptySectionTopSlack ||
                point.y > rect.bottom + emptySectionBottomSlack
            ) {
                continue;
            }

            return {
                kind: collectionDropKinds.sectionEmpty,
                parentId,
            };
        }

        const firstRect = cards[0].rect;
        const lastRect = cards[cards.length - 1].rect;
        const sectionLeft = Math.min(rect.left, firstRect.left, lastRect.left);
        const sectionRight = Math.max(rect.right, firstRect.right, lastRect.right);
        const topBandSlack = Math.max(24, Math.min(40, firstRect.height / 2));
        const bottomBandSlack = Math.max(24, Math.min(40, lastRect.height / 2));
        const extraBottomHit = 64;

        if (point.x < sectionLeft || point.x > sectionRight) {
            continue;
        }

        if (
            point.y >= firstRect.top - topBandSlack &&
            point.y <= firstRect.top + topBandSlack
        ) {
            return {
                kind: collectionDropKinds.sectionStart,
                parentId,
            };
        }

        if (
            point.y >= lastRect.bottom - bottomBandSlack &&
            point.y <= lastRect.bottom + extraBottomHit
        ) {
            return {
                kind: collectionDropKinds.sectionEnd,
                parentId,
            };
        }
    }

    return null;
};
