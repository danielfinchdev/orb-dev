// Stand-in for the desktop store: the games only read the sound settings from it, so everything is the default.
const state = { app: { config: { ui: {} } } };
export const getState = () => state;
export const setState = () => {};
export const useStore = (select) => select(state);
