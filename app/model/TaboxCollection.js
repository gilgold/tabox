class TaboxCollection {
    constructor(name, tabs, chromeGroups, color = null, createdOn = null, window = null) {
      const newUid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      this.uid = newUid;
      this.name = name;
      this.tabs = tabs;
      this.chromeGroups = chromeGroups;
      this.color = color ?? 'var(--bg-color)';
      this.createdOn = createdOn ?? Date.now();
      this.window = window;
    }
}

export default TaboxCollection;