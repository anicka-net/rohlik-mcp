import { RohlikAPI } from "../rohlik-api.js";
import { getCurrency } from "../locale.js";

export function createDeliveryInfoTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_delivery_info",
    definition: {
      title: "Get Delivery Info",
      description: "Get current delivery information and available time slots",
      inputSchema: {}
    },
    handler: async () => {
      try {
        const api = createRohlikAPI();
        const deliveryInfo = await api.getDeliveryInfo();

        if (!deliveryInfo) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No delivery information available."
              }
            ]
          };
        }

        const formatDeliveryInfo = (data: any): string => {
          const sections: string[] = [];
          
          if (data.nextAvailableDelivery) {
            sections.push(`🚚 NEXT AVAILABLE DELIVERY:
   Date: ${data.nextAvailableDelivery.date || 'Not available'}
   Time: ${data.nextAvailableDelivery.time || 'Not available'}`);
          }

          if (data.deliveryFee !== undefined) {
            sections.push(`💰 DELIVERY FEE: ${data.deliveryFee} ${getCurrency()}`);
          }

          if (data.minimumOrder !== undefined) {
            sections.push(`📦 MINIMUM ORDER: ${data.minimumOrder} ${getCurrency()}`);
          }

          if (data.deliveryArea) {
            sections.push(`📍 DELIVERY AREA: ${data.deliveryArea}`);
          }

          // If no structured data, show raw JSON
          if (sections.length === 0) {
            sections.push(`🚚 DELIVERY INFO:\n${JSON.stringify(data, null, 2)}`);
          }

          return sections.join('\n\n');
        };

        const output = formatDeliveryInfo(deliveryInfo);

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