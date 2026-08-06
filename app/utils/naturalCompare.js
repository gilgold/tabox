// Natural (human) string comparison that orders embedded numbers by value
// rather than lexically, so "Tab 2" sorts before "Tab 10".
const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base'
});

/**
 * Compare two values as strings using natural ordering.
 * Handles numbers embedded in strings ("Tab 2" < "Tab 10") and is
 * case-insensitive. Null/undefined are treated as empty strings.
 *
 * @param {*} a
 * @param {*} b
 * @returns {number} negative if a < b, positive if a > b, 0 if equal
 */
export function naturalCompare(a, b) {
    return collator.compare(
        a === null || a === undefined ? '' : a.toString(),
        b === null || b === undefined ? '' : b.toString()
    );
}
