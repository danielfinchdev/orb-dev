// Texts of the Órbita html page tile, the PR card and the ACP agents.
export default {
  'htmlpage.expand': 'Enlarge page',
  'htmlpage.expandedTitle': 'Enlarged page',
  'htmlpage.internetOn': 'Internet is on: this page can connect to https sites. Turn it on only if you trust the page.',
  'htmlpage.sandboxHelp': 'The page runs in a sandbox with no access to Orb, files or keys. With internet off it cannot connect. With internet on it can only use https. Known limit: even with internet off, a page using WebRTC over TURN/TCP might still send data to a server (the block closes UDP/STUN, not ICE-TCP); turn it on only for pages you trust.',
  'prcard.group': 'Pull request #{number} confirmation',
  'prcard.acceptMergeMethod': 'Merge ({method})',
  'prcard.dangerNote': 'Merging changes the base branch and cannot be undone from Orb. Check the checks before accepting.',
  'agents.hermesNote': 'Hermes only asks permission for what it considers dangerous, so Orb cannot guarantee it asks before every change. Turn it on only if you trust what you give it.',
  'agents.enable': 'Turn on'
};
