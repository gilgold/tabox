import React, { useEffect, useMemo, useState } from 'react';
import Modal from 'react-modal';
import {
    MdChevronRight,
    MdClose,
    MdDoneAll,
    MdFileDownload,
    MdFolder,
    MdFolderOpen,
    MdOutlineRemoveDone,
    MdSearch,
} from 'react-icons/md';
import MultiSelectCheckbox from '../MultiSelectCheckbox';
import { highlightText } from '../utils/searchUtils';
import FPBadge from './FPBadge';
import '../Modal.css';
import './LegacyImportPreviewModal.css';

const MAX_FAVICON_PREVIEW_COUNT = 6;
const ROOT_SECTION_ID = 'root';

function LegacyImportPreviewModal({
    isOpen,
    onClose,
    onConfirm,
    previewData,
    isImporting = false,
}) {
    const previewCollections = previewData?.collections || [];
    const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
    const [collapsedSectionIds, setCollapsedSectionIds] = useState(new Set());
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!isOpen || previewCollections.length === 0) {
            setSelectedCollectionIds([]);
            return;
        }

        setSelectedCollectionIds(previewCollections.map((collection) => collection.previewId));
    }, [isOpen, previewCollections]);

    useEffect(() => {
        if (!isOpen) {
            setCollapsedSectionIds(new Set());
            setSearchQuery('');
            return;
        }

        const nextCollapsedSectionIds = new Set(
            (previewData?.sections || [])
                .filter((section) => section.kind === 'folder')
                .filter(() => false)
                .map((section) => section.id)
        );
        setCollapsedSectionIds(nextCollapsedSectionIds);
        setSearchQuery('');
    }, [isOpen, previewData]);

    const selectedIdSet = useMemo(() => new Set(selectedCollectionIds), [selectedCollectionIds]);
    const selectedCount = selectedCollectionIds.length;
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    const importButtonLabel = isImporting
        ? 'Importing...'
        : `Import ${selectedCount} Selected`;

    const searchResults = useMemo(() => {
        if (!normalizedSearchQuery) {
            return [];
        }

        const sectionByParentId = new Map(
            (previewData?.sections || []).map((section) => [
                section.id === ROOT_SECTION_ID ? null : section.id.replace('folder:', ''),
                section,
            ])
        );

        return previewCollections.reduce((matches, collection) => {
            const collectionMatches = collection.name?.toLowerCase().includes(normalizedSearchQuery);
            const matchedTabs = (collection.previewTabs || []).filter((tab) => (
                tab.title?.toLowerCase().includes(normalizedSearchQuery) ||
                tab.url?.toLowerCase().includes(normalizedSearchQuery)
            ));

            if (!collectionMatches && matchedTabs.length === 0) {
                return matches;
            }

            matches.push({
                ...collection,
                matchedTabs,
                section: sectionByParentId.get(collection.sourceParentId || null) || null,
            });
            return matches;
        }, []);
    }, [normalizedSearchQuery, previewCollections, previewData]);

    const toggleCollection = (previewId) => {
        setSelectedCollectionIds((previous) => (
            previous.includes(previewId)
                ? previous.filter((value) => value !== previewId)
                : [...previous, previewId]
        ));
    };

    const toggleSection = (sectionId) => {
        setCollapsedSectionIds((previous) => {
            const next = new Set(previous);
            if (next.has(sectionId)) {
                next.delete(sectionId);
            } else {
                next.add(sectionId);
            }
            return next;
        });
    };

    const renderPreviewTabs = (collection) => {
        const visiblePreviewTabs = (collection.previewTabs || []).slice(0, MAX_FAVICON_PREVIEW_COUNT);
        const hiddenTabCount = Math.max(collection.tabCount - visiblePreviewTabs.length, 0);

        if (visiblePreviewTabs.length === 0) {
            return null;
        }

        return (
            <div
                className="legacy-import-preview-item-tabs"
                aria-label={`${collection.name} tab preview`}
            >
                {visiblePreviewTabs.map((tab, index) => (
                    <img
                        key={`${tab.url || tab.title || 'tab'}-${index}`}
                        src={tab.favIconUrl || './images/favicon-fallback.png'}
                        alt=""
                        title={tab.title}
                        className="legacy-import-preview-tab-favicon"
                        onError={(event) => {
                            if (event.target.dataset.fallbackApplied === 'true') {
                                return;
                            }

                            event.target.dataset.fallbackApplied = 'true';
                            event.target.src = './images/favicon-fallback.png';
                        }}
                    />
                ))}
                {hiddenTabCount > 0 && (
                    <span className="legacy-import-preview-tab-overflow">+{hiddenTabCount}</span>
                )}
            </div>
        );
    };

    const renderCollectionItem = (collection) => {
        const isSelected = selectedIdSet.has(collection.previewId);
        const searchMatchTabs = collection.matchedTabs?.length > 0
            ? collection.matchedTabs
            : (collection.previewTabs || []);

        return (
            <div
                key={collection.previewId}
                className={`legacy-import-preview-item${isSelected ? ' is-selected' : ''}`}
            >
                <div
                    className="legacy-import-preview-item-header"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleCollection(collection.previewId)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleCollection(collection.previewId);
                        }
                    }}
                >
                    <MultiSelectCheckbox
                        checked={isSelected}
                        ariaLabel={`Import ${collection.name}`}
                        accentColor="var(--primary-color)"
                        onClick={(event) => {
                            event.stopPropagation();
                            toggleCollection(collection.previewId);
                        }}
                    />
                    <span className="legacy-import-preview-item-name">{collection.name}</span>
                </div>
                <div className="legacy-import-preview-item-meta">
                    {collection.tabCount} tab{collection.tabCount !== 1 ? 's' : ''} • {collection.groupCount} group{collection.groupCount !== 1 ? 's' : ''}
                </div>
                {renderPreviewTabs(collection)}
                {normalizedSearchQuery && searchMatchTabs.length > 0 && (
                    <div className="legacy-import-preview-search-matches">
                        {searchMatchTabs.map((tab, index) => (
                            <div
                                key={`${collection.previewId}-match-${tab.url || tab.title || index}`}
                                className="legacy-import-preview-search-match-row"
                                title={tab.url || tab.title || ''}
                            >
                                {tab.favIconUrl && (
                                    <img
                                        src={tab.favIconUrl}
                                        alt=""
                                        className="legacy-import-preview-search-match-favicon"
                                        onError={(event) => { event.target.style.display = 'none'; }}
                                    />
                                )}
                                <span className="legacy-import-preview-search-match-title">
                                    {highlightText(tab.title, searchQuery, 'search-match-text') || tab.title}
                                </span>
                                <span className="legacy-import-preview-search-match-url">
                                    {highlightText(tab.url, searchQuery, 'search-match-text') || tab.url}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            contentLabel="Import Collections Preview"
            className="bulk-collection-modal legacy-import-preview-modal"
            overlayClassName="create-folder-modal-overlay"
            ariaHideApp={false}
            shouldCloseOnOverlayClick={true}
            shouldCloseOnEsc={true}
        >
            <div className="bulk-collection-modal-content">
                <div className="bulk-collection-modal-header">
                    <div className="bulk-collection-modal-title">
                        <MdFileDownload
                            style={{
                                color: 'var(--primary-color)',
                                fontSize: '20px',
                                marginRight: '8px',
                            }}
                        />
                        <span>Import Preview</span>
                    </div>
                    <button
                        className="bulk-collection-modal-close"
                        onClick={onClose}
                        type="button"
                    >
                        <MdClose />
                    </button>
                </div>

                <div className="bulk-collection-modal-body">
                    <div className="legacy-import-preview-summary">
                        <p className="legacy-import-preview-title">
                            {previewCollections.length} collection{previewCollections.length !== 1 ? 's' : ''} ready to import
                        </p>
                        <p className="legacy-import-preview-copy">
                            Review this TXT import before anything is added. Select the collections you want to bring in, then import only those selections.
                        </p>
                    </div>
                    <div className="legacy-import-preview-toolbar">
                        <label className="legacy-import-preview-search">
                            <MdSearch size={16} />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder="Search collections or tabs"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    className="legacy-import-preview-search-clear"
                                    aria-label="Clear search"
                                    onClick={() => setSearchQuery('')}
                                >
                                    <MdClose size={16} />
                                </button>
                            )}
                        </label>
                        <div className="legacy-import-preview-actions">
                            <button
                                type="button"
                                className="legacy-import-preview-action-btn"
                                onClick={() => setSelectedCollectionIds(previewCollections.map((collection) => collection.previewId))}
                            >
                                <MdDoneAll size={16} />
                                <span>Select All</span>
                            </button>
                            <button
                                type="button"
                                className="legacy-import-preview-action-btn secondary"
                                onClick={() => setSelectedCollectionIds([])}
                            >
                                <MdOutlineRemoveDone size={16} />
                                <span>Select None</span>
                            </button>
                        </div>
                    </div>
                    <div className="legacy-import-preview-scroll">
                        {normalizedSearchQuery ? (
                            <div className="legacy-import-preview-search-results">
                                <div className="legacy-import-preview-search-results-title">
                                    {searchResults.length} matching collection{searchResults.length !== 1 ? 's' : ''}
                                </div>
                                <div className="legacy-import-preview-section-list">
                                    {searchResults.map((collection) => renderCollectionItem(collection))}
                                </div>
                            </div>
                        ) : (
                            (previewData?.sections || []).map((section) => {
                                const isCollapsible = section.kind === 'folder';
                                const isCollapsed = collapsedSectionIds.has(section.id);
                                const FolderIcon = isCollapsed ? MdFolder : MdFolderOpen;

                                return (
                                    <div key={section.id} className="legacy-import-preview-section">
                                        <button
                                            type="button"
                                            className={`legacy-import-preview-section-header${isCollapsible ? ' is-collapsible' : ''}`}
                                            onClick={isCollapsible ? () => toggleSection(section.id) : undefined}
                                            aria-label={isCollapsible ? `Toggle ${section.title} folder section` : undefined}
                                        >
                                            <div className="legacy-import-preview-section-title-wrap">
                                                {section.kind === 'folder' ? (
                                                    <>
                                                        <span
                                                            className="legacy-import-preview-folder-swatch"
                                                            style={section.color ? { backgroundColor: section.color } : undefined}
                                                        />
                                                        <FolderIcon size={18} className="legacy-import-preview-folder-icon" />
                                                    </>
                                                ) : (
                                                    <FPBadge accent="neutral" className="legacy-import-preview-root-badge">Root</FPBadge>
                                                )}
                                                <span className="legacy-import-preview-section-title">{section.title}</span>
                                            </div>
                                            {isCollapsible && (
                                                <MdChevronRight
                                                    size={18}
                                                    className={`legacy-import-preview-section-chevron${isCollapsed ? '' : ' is-expanded'}`}
                                                />
                                            )}
                                        </button>
                                        {!isCollapsed && (
                                            <div className="legacy-import-preview-section-list">
                                                {(section.collections || []).map((collection) => renderCollectionItem(collection))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="bulk-collection-modal-footer">
                    <button
                        type="button"
                        className="bulk-collection-btn bulk-collection-btn-cancel"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="bulk-collection-btn bulk-collection-btn-primary"
                        onClick={() => onConfirm?.({ selectedCollectionIds })}
                        disabled={selectedCount === 0 || isImporting}
                    >
                        {importButtonLabel}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

export default LegacyImportPreviewModal;
