/**
 * A notification may be delivered over push, email, or both. The existing
 * dedupe table is item-level rather than channel-level, so an item is safe to
 * acknowledge only after at least one enabled channel confirms delivery.
 */
export function notificationDelivered(
  pushDelivered: boolean,
  emailDelivered: boolean,
): boolean {
  return pushDelivered || emailDelivered;
}
