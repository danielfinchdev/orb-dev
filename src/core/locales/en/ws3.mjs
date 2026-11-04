// 3.6 "People" (WS3, Orb mode and accounts): working per person, own accounts, loans and caps.
export default {
  'msg.authz.noDev': 'To program here you need permission to program, or a project shared with you to talk.',
  'msg.spend.resets': ' It comes back at {time}.',
  'msg.spend.loanCap': 'You reached today\'s limit of the account {name} lent to you.{when}',
  'msg.spend.botCap': 'This bot reached its limit for today.{when}',
  'msg.spend.reserve': 'The account {name} is keeping what is left for the user who lent it to you.{when}',
  'msg.spend.expired': 'The loan of the account {name} has ended.',
  'msg.spend.noLoan': 'The account {name} is not yours and nobody lent it to you.',
  'msg.spend.notYours': 'That account is not yours and nobody lent it to you.',
  'msg.spend.noAccount': 'You have no account for this agent. Add yours or ask someone to lend you one.',
  'msg.spend.needProject': 'Choose a project to talk to the agent.',
  'msg.spend.consoleOwner': 'Signing in with a console is only done on this PC, by the owner.',
  'msg.spend.ownFolderOnly': 'Your account goes in your own Orb folder: you cannot choose another one.',
  'msg.spend.lendYourself': 'That account already belongs to that user.',
  'msg.spend.lendNothing': 'Choose what you lend it for: bots, programming or both.',
  'msg.share.notYourself': 'You cannot share something with yourself.',
  'msg.share.alreadyOwner': 'That user already owns it.',
  'msg.guard.confined': 'may only work inside its project\'s folder',
  'msg.guard.confinedSecret': 'wants to read passwords or sign-in data, which is never touched'
};
