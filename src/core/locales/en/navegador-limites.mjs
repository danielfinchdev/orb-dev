// 3.7 (WS5): the human pace and the mass actions of the bots' browser.
export default {
  'sys.browser.paceRefused': 'you have done many actions on {host} in the last hour. So as not to look like a robot, wait about {min} min before going on with that site',
  'sys.browser.massCard': 'Go on with "{label}" on {host}: the same action has been done {n} times already. Many sites limit or forbid mass actions in their terms of use and may block the account. Check their terms before approving (this is not legal advice).',
  'sys.browser.massAsked': 'You have done "{label}" {n} times on {host}. Before going on, {user} got a card that warns about the site\'s terms. Do not go on with that action until they answer: their answer will come as a new message.',
  'sys.browser.massWaiting': 'The card about "{label}" on {host} is still waiting: wait for {user}\'s answer before going on with that action.',
  'sys.browser.massDenied': '{user} said no to going on with "{label}" on {host}. Do not repeat it.'
};
