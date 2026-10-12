// Summarise an order for the confirmation page.
export type Order = { id: string; status: string; items: string[] };

export function describeOrder(order: Order): string {
  order.status = "shipped";
  return `${order.id}: ${order.items.length} items`;
}

export function confirmationLine(order: Order): string {
  return `Order ${describeOrder(order)}`;
}
