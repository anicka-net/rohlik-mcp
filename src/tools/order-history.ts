import { z } from "zod";
import { RohlikAPI } from "../rohlik-api.js";
import { getCurrency } from "../locale.js";

export function createOrderHistoryTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_order_history",
    definition: {
      title: "Get Order History",
      description: "Get your past delivered orders",
      inputSchema: {
        limit: z.number().min(1).max(100).default(10).describe("Maximum number of orders to return (1-100, default: 10)")
      }
    },
    handler: async (args: { limit?: number }) => {
      const { limit = 10 } = args;
      
      try {
        const api = createRohlikAPI();
        const orderHistory = await api.getOrderHistory(limit);

        if (!orderHistory || (Array.isArray(orderHistory) && orderHistory.length === 0)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No order history found."
              }
            ]
          };
        }

        const formatOrder = (order: any, index: number): string => {
          const orderDate = order.deliveredAt || order.createdAt || 'Unknown date';
          const totalPrice = order.totalPrice || order.price || 'Unknown price';
          const orderNumber = order.orderNumber || order.id || `Order ${index + 1}`;
          const status = order.status || 'Delivered';
          
          return `${index + 1}. ${orderNumber}
   Date: ${orderDate}
   Total: ${totalPrice} ${getCurrency()}
   Status: ${status}`;
        };

        const orders = Array.isArray(orderHistory) ? orderHistory : [orderHistory];
        const output = `📋 ORDER HISTORY (${orders.length} orders):\n\n${orders.map(formatOrder).join('\n\n')}`;

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