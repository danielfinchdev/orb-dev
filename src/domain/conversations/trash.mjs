// The trash of the chats: a chat sent there only gets a date (trashed_at); after TRASH_DAYS it is deleted for good.
export const TRASH_DAYS = 7;
export const TRASH_MS = TRASH_DAYS * 24 * 3_600_000;

// The last moment a trashed chat can be restored (ISO), from the moment it was trashed.
export const undoUntil = (trashedAt) => new Date(Date.parse(trashedAt) + TRASH_MS).toISOString();
// Past the term a chat is as good as gone: restoring it is refused even if the purge has not run yet.
export const expired = (trashedAt, nowMs = Date.now()) => Date.parse(trashedAt) + TRASH_MS <= nowMs;
