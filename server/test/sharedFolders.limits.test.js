import { describe, it, expect, vi } from 'vitest';
import { makeDB } from './helpers/d1Mock.js';
import {
  createSharedFolder, putCollection, checkRateLimit,
  MAX_FOLDERS_PER_OWNER, MAX_COLLECTIONS_PER_FOLDER, MAX_NAME_LENGTH,
} from '../src/sharedFolders.js';

const OWNER = { googleId: 'g-owner', email: 'owner@x.com' };
const makeKV = (store = {}) => ({
  get: vi.fn(async (k) => store[k] ?? null),
  put: vi.fn(async (k, v) => { store[k] = v; }),
  _store: store,
});

describe('resource caps', () => {
  it('rejects folder names over MAX_NAME_LENGTH', async () => {
    const db = makeDB();
    const res = await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'x'.repeat(MAX_NAME_LENGTH + 1), collections: [] }, 1);
    expect(res).toEqual({ ok: false, status: 400, error: 'invalid_request' });
  });
  it('caps shared folders per owner', async () => {
    const db = makeDB();
    for (let i = 0; i < MAX_FOLDERS_PER_OWNER; i++) {
      expect((await createSharedFolder(db, OWNER, { folderId: `f${i}`, name: 'T', collections: [] }, 1)).ok).toBe(true);
    }
    expect(await createSharedFolder(db, OWNER, { folderId: 'f-over', name: 'T', collections: [] }, 1))
      .toEqual({ ok: false, status: 409, error: 'folder_limit' });
  });
  it('caps collections per folder on create and on insert', async () => {
    const db = makeDB();
    const many = Array.from({ length: MAX_COLLECTIONS_PER_FOLDER + 1 }, (_, i) => ({ uid: `c${i}`, data: {} }));
    expect(await createSharedFolder(db, OWNER, { folderId: 'f1', name: 'T', collections: many }, 1))
      .toEqual({ ok: false, status: 413, error: 'too_many_collections' });
    await createSharedFolder(db, OWNER, { folderId: 'f2', name: 'T', collections: many.slice(0, MAX_COLLECTIONS_PER_FOLDER) }, 1);
    expect(await putCollection(db, OWNER, 'f2', 'c-new', { data: {}, baseRev: 1 }, 2))
      .toEqual({ ok: false, status: 413, error: 'too_many_collections' });
  });
});

describe('checkRateLimit', () => {
  it('allows up to the limit within a window, then blocks', async () => {
    const env = { ENTITLEMENTS: makeKV() };
    for (let i = 0; i < 3; i++) expect(await checkRateLimit(env, 'g1', 'writes', 3, 60, 1000)).toBe(true);
    expect(await checkRateLimit(env, 'g1', 'writes', 3, 60, 1000)).toBe(false);
    // next window resets
    expect(await checkRateLimit(env, 'g1', 'writes', 3, 60, 1000 + 60_000)).toBe(true);
  });
});
