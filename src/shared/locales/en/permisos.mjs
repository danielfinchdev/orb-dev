// Who may do what (src/domain/security/permissions.mjs).
export default {
  'msg.authz.denied': 'You do not have access to this.',
  'msg.authz.messageNeedsTask': 'A message to another agent must be about one of your tasks (task_id).',
  'msg.authz.notYourLog': 'The log of {name} is not of a project of this conversation.',
  'msg.authz.notYourScope': 'Task #{id} is not of your conversation: you can only write to the tasks of your own conversation.',
  'msg.authz.notYourTask': 'Task #{id} is not of this conversation nor of your task.',
  'msg.authz.busy': 'Orb is busy and could not confirm your signature: try again in a few seconds.',
  'msg.authz.wrongAgent': 'Task #{id} belongs to {agent}: to reach it, send with to: "{agent}".',
  'msg.authz.unsigned': 'Orb did not sign this process: it cannot use the board.'
};
