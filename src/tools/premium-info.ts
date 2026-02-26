import { RohlikAPI } from "../rohlik-api.js";
import { getCurrency } from "../locale.js";

export function createPremiumInfoTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_premium_info",
    definition: {
      title: "Get Premium Info",
      description: "Get information about your Rohlik Premium subscription",
      inputSchema: {}
    },
    handler: async () => {
      try {
        const api = createRohlikAPI();
        const data = await api.getPremiumInfo();

        if (!data) {
          return { content: [{ type: "text" as const, text: "No premium information available." }] };
        }

        const cur = getCurrency();
        const lines: string[] = [];

        if (data.isActive !== undefined) lines.push(`Status: ${data.isActive ? 'active' : 'inactive'}`);

        if (data.subscription) {
          const s = data.subscription;
          lines.push(`Subscription: ${s.type || '?'}, ${s.startDate || '?'} – ${s.endDate || '?'}, ${s.price || '?'} ${cur}`);
        }

        if (data.benefits && Array.isArray(data.benefits)) {
          lines.push(`Benefits: ${data.benefits.map((b: any) => b.name || b).join(', ')}`);
        }

        if (data.totalSavings !== undefined) lines.push(`Total savings: ${data.totalSavings} ${cur}`);
        if (data.freeDeliveryCount !== undefined) lines.push(`Free deliveries used: ${data.freeDeliveryCount}`);

        // Fallback for raw API shape (card + prices + stats)
        if (lines.length === 0) {
          if (data.card) lines.push(`Card: ${data.card.maskedCln || '?'}, exp ${data.card.expiration || '?'}`);
          if (data.prices && Array.isArray(data.prices)) {
            const active = data.prices.find((p: any) => p.label);
            if (active) lines.push(`Next payment: ${active.label}`);
          }
          if (data.stats) {
            const s = data.stats;
            if (s.savedHours !== undefined) lines.push(`Saved hours: ${s.savedHours}`);
            if (s.savedOnDelivery !== undefined) lines.push(`Saved on delivery: ${s.savedOnDelivery} ${cur}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.length > 0 ? `Premium:\n${lines.join('\n')}` : 'Premium info returned but no recognizable fields.' }]
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
