export interface ReaderNote {
  id: string;
  title: string;
  body: string;
  lessonId: string | null;
  lessonTitle: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const NOTES_DB_NAME = "reader-notes";
const NOTES_STORE = "notes";
const NOTES_DB_VERSION = 1;

let notesDbPromise: Promise<IDBDatabase | null> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openNotesDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (notesDbPromise) return notesDbPromise;

  notesDbPromise = new Promise((resolve) => {
    const request = indexedDB.open(NOTES_DB_NAME, NOTES_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        const store = db.createObjectStore(NOTES_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

  return notesDbPromise;
}

export async function listNotes(): Promise<ReaderNote[]> {
  const db = await openNotesDb();
  if (!db) return [];

  const transaction = db.transaction(NOTES_STORE, "readonly");
  const store = transaction.objectStore(NOTES_STORE);
  const all = (await requestToPromise(store.getAll())) as ReaderNote[];
  await transactionToPromise(transaction);

  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveNote(note: ReaderNote): Promise<void> {
  const db = await openNotesDb();
  if (!db) return;

  const transaction = db.transaction(NOTES_STORE, "readwrite");
  const store = transaction.objectStore(NOTES_STORE);
  store.put(note);
  await transactionToPromise(transaction);
}

export async function deleteNote(noteId: string): Promise<void> {
  const db = await openNotesDb();
  if (!db) return;

  const transaction = db.transaction(NOTES_STORE, "readwrite");
  const store = transaction.objectStore(NOTES_STORE);
  store.delete(noteId);
  await transactionToPromise(transaction);
}
