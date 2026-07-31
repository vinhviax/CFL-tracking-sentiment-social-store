import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// node:test has no DOM, and this module's whole job is talking to sessionStorage.
const store = new Map();
globalThis.sessionStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { ADMIN_HEADER, clearAdminKey, getAdminKey, setAdminKey } = await import("./adminSession.js");

beforeEach(() => store.clear());

test("the key rides in a header, never a query parameter", () => {
  assert.equal(ADMIN_HEADER, "X-CFL-Admin-Key");
});

test("a tab with no key is a viewer", () => {
  assert.equal(getAdminKey(), null);
});

test("an unlocked tab keeps the key across a reload", () => {
  setAdminKey("mat-khau");
  assert.equal(getAdminKey(), "mat-khau");
});

test("locking again removes the key rather than storing an empty one", () => {
  setAdminKey("mat-khau");
  clearAdminKey();
  assert.equal(getAdminKey(), null);
  assert.equal(store.size, 0);
});

test("storage that throws leaves the tab read-only instead of crashing the page", () => {
  const working = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem() { throw new Error("private mode"); },
    setItem() { throw new Error("private mode"); },
    removeItem() { throw new Error("private mode"); },
  };
  try {
    assert.equal(getAdminKey(), null);
    assert.doesNotThrow(() => setAdminKey("mat-khau"));
  } finally {
    globalThis.sessionStorage = working;
  }
});
