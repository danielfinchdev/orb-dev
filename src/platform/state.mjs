// Orb's internal state in the settings table of orb.db (not the user's settings: those are orb.json). The keys used
// across modules are named here.

// 3.8: the folders of other users' projects of 3.7 that stay in the categories, which Orb no longer lists (JSON list of
// folderKey; the 3.8 migration writes it, adding one of them by hand takes it out).
export const IGNORED_PROJECTS = 'projects_ignored';
// 3.8.1: the projects the user finished (src/core/project-close.mjs): their folders stay, Orb no longer lists them.
export const FINISHED_PROJECTS = 'projects_finished';
// 3.8.1: the projects being deleted (between the engine's check and the end of the Recycle Bin: project-close.mjs).
export const DELETING_PROJECTS = 'projects_deleting';
