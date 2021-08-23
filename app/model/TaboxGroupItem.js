import { uid } from 'react-uid';

class TaboxGroupItem {
    constructor(name, tabs, chromeGroups, color = null, createdOn = null) {
      this.uid = uid(this);
      this.name = name;
      this.tabs = tabs;
      this.chromeGroups = chromeGroups;
      this.color = color ?? 'var(--bg-color)';
      this.createdOn = createdOn ?? Date.now();
    }
}

export default TaboxGroupItem;