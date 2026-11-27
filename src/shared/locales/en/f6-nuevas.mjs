// Texts of the Órbita html page tile, the PR card and the ACP agents.
export default {
  'htmlpage.expand': 'Enlarge page',
  'htmlpage.expandedTitle': 'Enlarged page',
  'htmlpage.internetOn': 'Internet is on: this page can connect to https sites. Turn it on only if you trust the page.',
  'htmlpage.sandboxHelp': 'The page runs in a sandbox with no access to Orb, files or keys. With internet off it cannot connect. With internet on it can only use https. Known limit: even with internet off, a page using WebRTC over TURN/TCP might still send data to a server (the block closes UDP/STUN, not ICE-TCP); close pages you do not trust.',
  'prcard.group': 'Pull request #{number} confirmation',
  'prcard.acceptMergeMethod': 'Merge ({method})',
  'prcard.dangerNote': 'Merging changes the base branch and cannot be undone from Orb. Check the checks before accepting.',
  'agents.hermesNote': 'Hermes only asks permission for what it considers dangerous, so Orb cannot guarantee it asks before every change. Turn it on only if you trust what you give it.',
  'agents.unverifiedNote': 'We haven’t fully tested it with the real program yet. If it doesn’t start, Orb will tell you and you can remove it.',
  'agents.noGuardNote': 'This agent can’t ask Orb before acting. It doesn’t follow Orb’s fixed protections, such as protected paths or adb. It only starts in chats with Full access.',
  'agents.keyTitle': "{name} key",
  'agents.keyDesc': "Saved in the vault with your master password. Orb never shows it again.",
  'agents.keySaved': "Key saved in the vault",
  'agents.keySet': "Save {name}",
  'agents.keyChange': "Change {name} (saved)",
  'agents.keyHint': "Optional if you already signed in with the program itself.",
  'agents.enable': 'Turn on'
};
