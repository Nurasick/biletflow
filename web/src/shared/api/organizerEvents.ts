import { emptyOrganizerEvent, eventSchema } from "../../features/Organizer/model/eventSchema";
import type { OrganizerEventValues } from "../../features/Organizer/model/eventSchema";
import { organizerApi } from "./organizer";

type DraftStorage = {
  read: (key: number) => Promise<unknown>;
  write: (key: number, values: OrganizerEventValues) => Promise<void>;
};

// IndexedDB keeps image data out of localStorage's small synchronous quota.
const withDraftStore = <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    let blocked = false;
    const open = indexedDB.open("biletflow-organizer-events", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("drafts");
    open.onerror = () => reject(open.error);
    open.onblocked = () => { blocked = true; reject(new Error("Storage upgrade blocked")); };
    open.onsuccess = () => {
      const database = open.result;
      if (blocked) { database.close(); return; }
      database.onversionchange = () => database.close();
      try {
        const transaction = database.transaction("drafts", mode);
        const request = operation(transaction.objectStore("drafts"));
        transaction.oncomplete = () => { database.close(); resolve(request.result); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      } catch (error) {
        database.close();
        reject(error);
      }
    };
  });

const browserDraftStorage: DraftStorage = {
  read: (key) => withDraftStore("readonly", (store) => store.get(key)),
  write: async (key, values) => { await withDraftStore("readwrite", (store) => store.put(values, key)); },
};

export class OrganizerEventError extends Error {
  constructor(message: "organizerEvent.loadError" | "organizerEvent.saveError" | "organizerEvent.accessError") {
    super(message);
    this.name = "OrganizerEventError";
  }
}

export const EVENT_DEMO_ERRORS = { load: false, save: false };

export const createOrganizerEventApi = (storage: DraftStorage = browserDraftStorage) => {
  const requireOrganizer = (userId: number) => {
    const session = organizerApi.currentSession();
    if (!session || session.id !== userId || session.role !== "organizer") {
      throw new OrganizerEventError("organizerEvent.accessError");
    }
  };
  return {
    getDraft: async (userId: number): Promise<OrganizerEventValues> => {
      requireOrganizer(userId);
      try {
        if (EVENT_DEMO_ERRORS.load) throw new Error();
        const saved = await storage.read(userId);
        return saved === undefined ? emptyOrganizerEvent() : eventSchema.parse(saved);
      } catch {
        throw new OrganizerEventError("organizerEvent.loadError");
      }
    },
    saveDraft: async (userId: number, values: OrganizerEventValues): Promise<OrganizerEventValues> => {
      requireOrganizer(userId);
      const draft = eventSchema.parse(values);
      try {
        if (EVENT_DEMO_ERRORS.save) throw new Error();
        await storage.write(userId, draft);
        return draft;
      } catch {
        throw new OrganizerEventError("organizerEvent.saveError");
      }
    },
  };
};

export const organizerEventApi = createOrganizerEventApi();
