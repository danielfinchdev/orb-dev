// 3.2.1: every navigation moves a counter. An answer that arrives later (the conversation a first message just made)
// takes the user there only if they have not gone anywhere meanwhile: pressing «Nuevo chat» one second after sending
// used to be undone by the late answer, and the next message fell into the previous conversation.
let seq = 0;
export const bumpNav = () => ++seq;
export const navTicket = () => seq;
export const stillHere = (ticket) => ticket === seq;
