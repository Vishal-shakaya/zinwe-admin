/** The sidebar badges (payments to check, support waiting) reload when this event fires. */
export const BADGES_EVENT = "zinwe:badges";

/** Call after something that changes a count (a payment reviewed, a ticket answered) to refresh the badges now. */
export function refreshBadges(): void {
  window.dispatchEvent(new Event(BADGES_EVENT));
}
