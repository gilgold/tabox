class TaboxCollection {
    constructor(name, tabs, chromeGroups, color = null, createdOn = null, window = null, lastUpdated = null, lastOpened = null) {
      const newUid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      this.uid = newUid;
      this.name = name;
      this.tabs = tabs;
      this.chromeGroups = chromeGroups;
      this.color = color ?? 'var(--setting-row-border-color)';
      this.createdOn = createdOn ?? Date.now();
      // Only set current time if lastUpdated is explicitly null/undefined, preserve existing timestamps (including 0)
      this.lastUpdated = lastUpdated !== null && lastUpdated !== undefined ? lastUpdated : Date.now();
      this.window = window;
      // Track when collection was last opened (tabs launched from it) - null for never opened
      this.lastOpened = lastOpened !== null && lastOpened !== undefined ? lastOpened : null;
    }
}

export default TaboxCollection;