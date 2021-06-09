class TaboxGroupItem {
    constructor(name, tabs, chromeGroups, color = null, createdOn = null) {
      this.name = name;
      this.tabs = tabs;
      this.chromeGroups = chromeGroups;
      this.color = color ?? 'var(--bg-color)';
      this.createdOn = createdOn ?? Date.now();
    }
}

export default TaboxGroupItem;