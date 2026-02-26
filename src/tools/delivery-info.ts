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
        const data = await api.getDeliveryInfo();

        if (!data) {
          return { content: [{ type: "text" as const, text: "No delivery information available." }] };
        }

        const cur = getCurrency();
        const lines: string[] = [];

        if (data.nextAvailableDelivery) {
          const d = data.nextAvailableDelivery;
          lines.push(`Next delivery: ${d.date || '?'} ${d.time || ''}`);
        }
        if (data.deliveryFee !== undefined) lines.push(`Delivery fee: ${data.deliveryFee} ${cur}`);
        if (data.minimumOrder !== undefined) lines.push(`Minimum order: ${data.minimumOrder} ${cur}`);
        if (data.deliveryArea) lines.push(`Area: ${data.deliveryArea}`);

        // Fallback: pick out known useful keys, skip the rest
        if (lines.length === 0) {
          const keys = ['deliveryType', 'firstDeliveryText', 'deliveryLocationText', 'earlierDelivery'];
          for (const k of keys) {
            if (data[k] !== undefined) {
              const v = typeof data[k] === 'object' ? (data[k].default || JSON.stringify(data[k])) : data[k];
              lines.push(`${k}: ${v}`);
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.length > 0 ? lines.join('\n') : 'No delivery details found.' }]
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
    }
  };
}
