import { RohlikAPI } from "../rohlik-api.js";
import { getCurrency } from "../locale.js";

export function createDeliverySlotsTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_delivery_slots",
    definition: {
      title: "Get Delivery Slots",
      description: "Get available delivery time slots for your address",
      inputSchema: {}
    },
    handler: async () => {
      try {
        const api = createRohlikAPI();
        const deliverySlots = await api.getDeliverySlots();

        if (!deliverySlots) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No delivery slots available."
              }
            ]
          };
        }

        const formatSlots = (data: any): string => {
          if (Array.isArray(data)) {
            return `⏰ AVAILABLE DELIVERY SLOTS:\n\n${data.map((slot, index) => 
              `${index + 1}. ${slot.date || 'Unknown date'} ${slot.time || slot.timeRange || 'Unknown time'}
   Price: ${slot.price || slot.deliveryFee || 'Free'} ${getCurrency()}
   Available: ${slot.available ? 'Yes' : 'No'}`
            ).join('\n\n')}`;
          }
          
          return `⏰ DELIVERY SLOTS:\n${JSON.stringify(data, null, 2)}`;
        };

        const output = formatSlots(deliverySlots);

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