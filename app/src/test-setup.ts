// Provides an in-memory IndexedDB implementation so LocalStore/Dexie can be
// instantiated during unit tests (jsdom/happy-dom have no IndexedDB).
import 'fake-indexeddb/auto';
