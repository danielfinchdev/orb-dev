// 3.6 "People" (WS4, bots per person): shared bots, each person's cards, memories with history, the house and
// "Take my bots".
export default {
  'msg.bots.brainNotConfined': '{agent} can\'t be a bot\'s brain: it could read any file on this computer. Choose Claude or Codex.',
  'msg.bots.brainBrokeOut': 'This Codex won\'t let its commands be turned off, so it\'s no longer used for bots. Update Codex or choose Claude.',
  'msg.bots.accountNotYours': 'The account chosen for {name} isn\'t yours and wasn\'t lent to you for bots. Choose another one in the bot\'s editor.',
  'msg.bots.notApprover': 'You can\'t approve this card.',
  'msg.bots.card.memory.mine': '{bot} wants to save in your memory: {text}',
  'msg.bots.card.memory.bot': '{bot} wants to save in the bot\'s memory (everyone who talks to it reads it): {text}',
  'msg.bots.card.memory.global': '{bot} wants to save in your global memory: {text}',
  'msg.bots.reminderLate': '({n} min late)',
  'msg.bots.memoryGone': 'That memory change isn\'t waiting anymore.',
  'msg.bots.badHaAllow': 'I don\'t understand "{entry}". Write domain.service and the entity, for example: light.turn_on light.living_room',
  'msg.bots.moveMismatch': 'The copy of {name} didn\'t come out the same.',
  'sys.botmcp.memoryPending': 'Saved as pending: {user} has to approve it first.',
  'msg.guard.botOtherPerson': 'wants to read what another user keeps in this bot'
};
