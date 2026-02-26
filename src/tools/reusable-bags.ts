import { RohlikAPI } from "../rohlik-api.js";

export function createReusableBagsTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_reusable_bags_info",
    definition: {
      title: "Get Reusable Bags Info",
      description: "Get information about your reusable bags and environmental impact",
      inputSchema: {}
    },
    handler: async () => {
      try {
        const api = createRohlikAPI();
        const data = await api.getReusableBagsInfo();

        if (!data) {
          return { content: [{ type: "text" as const, text: "No reusable bags information available." }] };
        }

        const lines: string[] = [];

        // Structured fields
        if (data.current !== undefined && data.max !== undefined) {
          lines.push(`Bags: ${data.current}/${data.max}`);
        }
        if (data.totalBags !== undefined) lines.push(`Total bags: ${data.totalBags}`);
        if (data.availableBags !== undefined) lines.push(`Available: ${data.availableBags}`);
        if (data.plasticSaved !== undefined) lines.push(`Plastic saved: ${data.plasticSaved}g`);
        if (data.co2Saved !== undefined) lines.push(`CO2 saved: ${data.co2Saved}g`);
        if (data.deposit !== undefined && data.deposit !== null) lines.push(`Deposit: ${data.deposit}`);

        return {
          content: [{ type: "text" as const, text: lines.length > 0 ? lines.join('\n') : 'Bags: no details available' }]
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
