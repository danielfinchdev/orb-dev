// For a promise whose failure is harmless by design (a list that refreshes again soon, a window nicety, a sound that
// did not start). It leaves a trace in the console instead of swallowing the error silently; anything the person
// asked for must notify() instead.
export const quiet = (error) => { console.debug('[orb] ignored:', error?.message ?? error); };
