import type { Deck, DeckProgress } from "../types";
import { sampleDeck } from "./sampleDeck";

const DB_NAME = "enhanced-drug-flashcards";
const DB_VERSION = 1;
const DECKS_STORE = "decks";
const PROGRESS_STORE = "progress";
const SETTINGS_STORE = "settings";
const SAMPLE_KEY = "sample-seeded";

type SettingRecord = {
  key: string;
  value: unknown;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(DECKS_STORE)) {
        database.createObjectStore(DECKS_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(PROGRESS_STORE)) {
        database.createObjectStore(PROGRESS_STORE, { keyPath: "deckId" });
      }

      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  runner: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);

        transaction.oncomplete = () => database.close();
        transaction.onerror = () => reject(transaction.error);

        runner(store, resolve, reject);
      })
  );
}

async function getSetting<T>(key: string): Promise<T | undefined> {
  return withStore<T | undefined>(SETTINGS_STORE, "readonly", (store, resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve((request.result as SettingRecord | undefined)?.value as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function putSetting(key: string, value: unknown): Promise<void> {
  return withStore<void>(SETTINGS_STORE, "readwrite", (store, resolve, reject) => {
    const request = store.put({ key, value } satisfies SettingRecord);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getAppSetting<T>(key: string): Promise<T | undefined> {
  return getSetting<T>(key);
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  await putSetting(key, value);
}

export async function ensureSeedDeck(): Promise<void> {
  const seeded = await getSetting<boolean>(SAMPLE_KEY);
  if (seeded) {
    return;
  }

  await saveDeck(sampleDeck);
  await putSetting(SAMPLE_KEY, true);
}

export async function getDecks(): Promise<Deck[]> {
  return withStore<Deck[]>(DECKS_STORE, "readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const decks = (request.result as Deck[]).sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      );
      resolve(decks);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveDeck(deck: Deck): Promise<void> {
  await withStore<void>(DECKS_STORE, "readwrite", (store, resolve, reject) => {
    const request = store.put(deck);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteDeck(deckId: string): Promise<void> {
  await withStore<void>(DECKS_STORE, "readwrite", (store, resolve, reject) => {
    const request = store.delete(deckId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  await withStore<void>(PROGRESS_STORE, "readwrite", (store, resolve, reject) => {
    const request = store.delete(deckId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getProgress(deckId: string): Promise<DeckProgress> {
  const progress = await withStore<DeckProgress | undefined>(
    PROGRESS_STORE,
    "readonly",
    (store, resolve, reject) => {
      const request = store.get(deckId);
      request.onsuccess = () => resolve(request.result as DeckProgress | undefined);
      request.onerror = () => reject(request.error);
    }
  );

  return (
    progress ?? {
      deckId,
      masteredCardIds: [],
      missedCardIds: [],
      recentDrugIds: [],
      pinnedDrugIds: []
    }
  );
}

export async function saveProgress(progress: DeckProgress): Promise<void> {
  await withStore<void>(PROGRESS_STORE, "readwrite", (store, resolve, reject) => {
    const request = store.put(progress);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
