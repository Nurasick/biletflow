import type { OrganizerTicketType } from "../../../shared/api/eventLifecycle";
import type { TicketTypeInput } from "../../../shared/api/eventManagement";
import { parseApiInstant } from "../../../shared/lib/parseApiInstant";
import { readEventLocalTime, toLocalDateTime } from "./eventDateTime";

const MAX_INT = 2_147_483_647;

export const ticketTypeDraft = (timeZone: string, ticket?: OrganizerTicketType) => ({
  name: ticket?.name ?? "",
  description: ticket?.description ?? "",
  price: String((ticket?.price_minor ?? 0) / 100),
  quantity: String(ticket?.quantity_total ?? 100),
  maxPerOrder: ticket?.max_per_order?.toString() ?? "",
  starts: ticket?.sales_start_at ? toLocalDateTime(ticket.sales_start_at, timeZone) : "",
  ends: ticket?.sales_end_at ? toLocalDateTime(ticket.sales_end_at, timeZone) : "",
  position: String(ticket?.position ?? 0),
  hidden: ticket?.is_hidden ?? false,
});

export type TicketTypeDraft = ReturnType<typeof ticketTypeDraft>;
type ValidationError = "ticketTypes.invalidName" | "ticketTypes.invalidPrice" | "ticketTypes.invalidQuantity"
  | "ticketTypes.invalidLimit" | "ticketTypes.invalidPosition" | "ticketTypes.invalidWindow"
  | "ticketTypes.quantityCommitted" | NonNullable<ReturnType<typeof readEventLocalTime>["error"]>;

const integer = (input: string, min: number, max = MAX_INT) => {
  if (!/^-?\d+$/.test(input.trim())) return null;
  const value = Number(input);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
};

const priceInMinorUnits = (input: string) => {
  const amount = input.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.replace(",", ".").split(".");
  const value = Number(`${whole}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(value) ? value : null;
};

export const ticketTypeInput = (draft: TicketTypeDraft, timeZone: string, committed: number, ticket?: OrganizerTicketType):
  { input: TicketTypeInput; error?: never } | { input?: never; error: ValidationError; field: keyof TicketTypeDraft } => {
  const name = draft.name.trim();
  if (!name || name.length > 200) return { field: "name", error: "ticketTypes.invalidName" };
  const price = ticket && draft.price === String(ticket.price_minor / 100)
    ? ticket.price_minor : priceInMinorUnits(draft.price);
  if (price === null) return { field: "price", error: "ticketTypes.invalidPrice" };
  const quantity = integer(draft.quantity, 1);
  if (quantity === null) return { field: "quantity", error: "ticketTypes.invalidQuantity" };
  if (quantity !== ticket?.quantity_total && quantity < committed) {
    return { field: "quantity", error: "ticketTypes.quantityCommitted" };
  }
  const limit = draft.maxPerOrder.trim() ? integer(draft.maxPerOrder, 1) : null;
  if (draft.maxPerOrder.trim() && limit === null) return { field: "maxPerOrder", error: "ticketTypes.invalidLimit" };
  const position = integer(draft.position, -MAX_INT - 1);
  if (position === null) return { field: "position", error: "ticketTypes.invalidPosition" };
  const start = readEventLocalTime(draft.starts, timeZone, ticket?.sales_start_at);
  if (start.error) return { field: "starts", error: start.error };
  const end = readEventLocalTime(draft.ends, timeZone, ticket?.sales_end_at);
  if (end.error) return { field: "ends", error: end.error };
  if (start.instant && end.instant && parseApiInstant(end.instant) <= parseApiInstant(start.instant)) {
    return { field: "ends", error: "ticketTypes.invalidWindow" };
  }
  return { input: {
    name: draft.name === ticket?.name ? ticket.name : name,
    description: draft.description === (ticket?.description ?? "")
      ? ticket?.description ?? null : draft.description.trim() || null,
    price_minor: price,
    quantity_total: quantity,
    max_per_order: limit,
    sales_start_at: start.instant,
    sales_end_at: end.instant,
    position,
    is_hidden: draft.hidden,
  } };
};

export const ticketTypeChanges = (input: TicketTypeInput, ticket: OrganizerTicketType): Partial<TicketTypeInput> =>
  Object.fromEntries((Object.keys(input) as (keyof TicketTypeInput)[])
    .filter((field) => input[field] !== ticket[field]).map((field) => [field, input[field]]));
