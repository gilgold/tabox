import { browser } from '../../static/globals';

const KEY = 'tabox_contacts';

export async function loadContacts() {
    const { [KEY]: contacts = [] } = await browser.storage.local.get(KEY);
    return contacts;
}

export async function saveContact({ name, email }) {
    const normalized = String(email).trim().toLowerCase();
    const contacts = await loadContacts();
    const next = contacts.filter((c) => c.email !== normalized);
    next.push({ name: String(name || '').trim() || normalized, email: normalized });
    next.sort((a, b) => a.name.localeCompare(b.name));
    await browser.storage.local.set({ [KEY]: next });
    return next;
}

export async function searchContacts(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return (await loadContacts()).filter((c) => c.name.toLowerCase().includes(q) || c.email.includes(q));
}
