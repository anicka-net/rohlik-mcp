import { RohlikAPI } from "../rohlik-api.js";
import { getCurrency } from "../locale.js";

export function createUpcomingOrdersTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_upcoming_orders",
    definition: {
      title: "Get Upcoming Orders",
      description: "Get your scheduled upcoming orders",
      inputSchema: {}
    },
    handler: async () => {
      try {
        const api = createRohlikAPI();
        const upcomingOrders = await api.getUpcomingOrders();

        if (!upcomingOrders || (Array.isArray(upcomingOrders) && upcomingOrders.length === 0)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No upcoming orders found."
              }
            ]
          };
        }

        const formatUpcomingOrder = (order: any, index: number): string => {
          const deliveryDate = order.deliveryDate || order.scheduledAt || 'Unknown date';
          const deliveryTime = order.deliveryTime || order.timeSlot || 'Unknown time';
          const totalPrice = order.totalPrice || order.price || 'Unknown price';
          const orderNumber = order.orderNumber || order.id || `Order ${index + 1}`;
          const status = order.status || 'Scheduled';
          const itemCount = order.itemCount || order.items?.length || 'Unknown';
          
          return `${index + 1}. ${orderNumber}
   Delivery: ${deliveryDate} ${deliveryTime}
   Total: ${totalPrice} ${getCurrency()}
   Items: ${itemCount}
   Status: ${status}`;
        };

        const orders = Array.isArray(upcomingOrders) ? upcomingOrders : [upcomingOrders];
        const output = `📦 UPCOMING ORDERS (${orders.length} orders):\n\n${orders.map(formatUpcomingOrder).join('\n\n')}`;

        return {
          content: [
            {
              type: "text" as const,
              text: output
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : String(error)
            }
          ],
          isError: true
        };
      }
    }
  };
}