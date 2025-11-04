class TaboxFolder {
    constructor(name, color = null, createdOn = null, lastUpdated = null, collapsed = false) {
        const newUid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        this.uid = newUid;
        this.name = name;
        this.type = 'folder';
        this.color = color ?? 'var(--folder-default-color)';
        this.createdOn = createdOn ?? Date.now();
        // Only set current time if lastUpdated is explicitly null/undefined, preserve existing timestamps (including 0)
        this.lastUpdated = lastUpdated !== null && lastUpdated !== undefined ? lastUpdated : Date.now();
        this.collapsed = collapsed;
        // Order for sorting - defaults to high number so new folders appear at end
        this.order = 999999;
        // Computed field - will be calculated from collections with this folder as parentId
        this.collectionCount = 0;
    }
}

export default TaboxFolder; 