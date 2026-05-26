/**
 * Central place for X DM UI selectors. Update when the site changes.
 */
window.XDM = window.XDM || {};

window.XDM.selectors = {
  /** Prefer scoping searches to this node (conversation transcript). */
  dmActivityViewport: '[data-testid="DmActivityViewport"]',

  /** Classic DM bubble (incoming often `div`, outgoing sometimes `button`). */
  messageEntry: '[data-testid="messageEntry"]',

  /** Seen on media/card DM rows — use when no `messageEntry` in subtree. */
  dmCompositeMessage: '[data-testid="DMCompositeMessage"]',

  /** Legacy: some builds used BUTTON only for outgoing. */
  outgoingMessageEntry: 'button[data-testid="messageEntry"]',

  caret: '[data-testid="caret"]',

  cellInnerDiv: '[data-testid="cellInnerDiv"]',

  confirmDelete: '[data-testid="confirmationSheetConfirm"]',
};
