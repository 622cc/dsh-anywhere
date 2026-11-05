// Where the chat stands after a message is sent: at its end, right above the composer, while the sent message and its
// reply fit on screen. Once they outgrow it, the chat stops following and the sent message stays at the top, so a long
// reply is read from its start; the way down to the latest shows.

/** The chat list's top and bottom padding (chat.tsx's contentStyle). */
export const PADDING = 12 + 4

/** `turn` is the height from the sent message to the end of the chat (-1 with none sent), `viewport` the list's. */
export const followsEnd = (turn: number, viewport: number) => turn >= 0 && viewport > 0 && turn <= viewport - PADDING
