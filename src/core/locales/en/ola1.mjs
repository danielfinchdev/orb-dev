// 3.6, design wave 1: the composer (action slot, reasoning and orchestrator), Settings in six sections, the Users screen
// and compacting conversations. Loaded last: it also corrects some earlier texts.
export default {
  // Reasoning: the brain button and its menu
  'reasoning.xhigh': 'Extra',
  'reasoning.title': 'Reasoning: {level}',
  'reasoning.titleText': 'How much it thinks before answering. More reasoning gives more careful answers and uses more.',
  'reasoning.use.low': 'Low usage',
  'reasoning.use.medium': 'Medium usage',
  'reasoning.use.high': 'High usage',
  'reasoning.use.xhigh': 'Very high usage',
  'reasoning.tasks.low': 'Quick questions, short texts and small changes.',
  'reasoning.tasks.medium': 'Everyday work: explaining, writing and coding.',
  'reasoning.tasks.high': 'Hard problems, multi-step plans and thorough reviews.',
  'reasoning.tasks.xhigh': 'The most complex work: architecture, hard-to-find bugs and long analyses.',
  // Orchestrator: icon and small switch
  'chat.orchestratorTip': 'Orchestrator: {name} distributes the work across several agents',
  'chat.orchestratorLocked': 'In this conversation {name} coordinates the agents. To talk to an agent directly, start a new chat with the Orchestrator off.',
  'chat.orchestratorOn': 'On. Turn it off to talk directly to the chosen agent.',
  'chat.orchestratorOff': 'Off: you talk directly to the chosen agent.',
  'chat.orchestratorHint': 'On, {name} coordinates the agents and hands out the work. Off, you talk directly to the chosen agent.',
  // Compact
  'compact.button': 'Compact',
  'compact.busy': 'Compacting…',
  'compact.title': 'Compact the conversation',
  'compact.tip': 'The context is almost full. The conversation is summarised so it can continue with more room; the history is kept.',
  'msg.orch.compactBusy': 'Wait for the current answer to finish before compacting the conversation.',
  'msg.orch.compacted': 'Conversation compacted. It continues from a summary; the history is kept.',
  'msg.orch.compactRenewed': 'Conversation compacted. The next answer starts from a summary of the conversation; the history is kept.',
  'msg.sessions.compactNotHere': 'Only direct conversations can be compacted.',
  'msg.sessions.cannotCompact': '{label} cannot compact the conversation.',
  'msg.sessions.compacting': 'Compacting the conversation',
  'msg.sessions.compacted': 'Conversation compacted. It continues from a summary; the history is kept.',
  'msg.sessions.compactFailed': '{label} could not compact the conversation. You can keep writing as usual.',
  'msg.api.reasoningXhigh': 'extra',
  'msg.api.reasoningUnavailable': 'This model does not support Extra reasoning.',
  // Settings in six sections
  'settings.section.magiclink': 'Magic Link',
  'settings.section.agentes': 'Agents and usage',
  'settings.section.avanzado': 'Advanced',
  'settings.section.acerca': 'About',
  'settings.sectionDesc.general': 'Assistant, language, working folder, appearance and updates.',
  'settings.sectionDesc.magiclink': 'Who can enter this Orb: its users, their devices and the linked Orbs.',
  'settings.sectionDesc.agentes': 'How conversations and tasks work, and how much usage they may spend.',
  'settings.sectionDesc.avanzado': 'Agent tools and God mode.',
  'settings.sectionDesc.acerca': 'Version, feedback and other apps.',
  'settings.group.apariencia': 'Appearance',
  'settings.group.actualizaciones': 'Updates',
  'settings.group.usuarios': 'Users',
  'settings.group.dispositivos': 'Devices',
  'settings.group.orbs': 'Linked Orbs',
  'settings.group.herramientas': 'Tools',
  'settings.group.experto': 'God mode',
  'settings.group.contribuye': 'Contribute',
  'settings.group.apps': 'More apps',
  'settings.mobile': 'Access from other devices',
  'about.developer': 'Developer',
  'about.license': 'Licence',
  // Users
  'persons.actions': 'Actions for {name}',
  'persons.edit': 'Edit name',
  // Welcome wizard
  'wizard.addPerson': 'Add another user',
  // Texts that pointed to the old sections
  'help.faq.10.a': 'The Professional theme hides the robot and animations; change it in Settings › General, where the floating robot is also turned on or off.',
  // Pie de la barra lateral en un navegador enlazado: el engranaje abre este dispositivo y Magic Link
  'nav.thisDevice': 'This device'
};
