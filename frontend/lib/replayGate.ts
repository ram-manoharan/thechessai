// Tracks whether the "Play it out" replay modal is currently open, so the
// analyze page's global arrow-key handler (NavControls) can yield keyboard
// navigation to the replay modal instead of silently driving the real
// game's position underneath it while the modal is up.
export const replayGate = { active: false };
