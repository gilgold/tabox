export const SortType = {
    COLOR: (a, b) => (b.color > a.color) ? -1 : ((a.color > b.color) ? 1 : 0),
    DATE: (a, b) => b.lastUpdated && a.lastUpdated ? b.lastUpdated - a.lastUpdated : b.createdOn - a.createdOn || 0,
    NAME: (a, b) => (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : 0)
}