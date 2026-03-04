import { z } from "zod";
import { RohlikAPI } from "../rohlik-api.js";

export function createLastMinuteTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_last_minute",
    definition: {
      title: "Get Last Minute Deals",
      description: "Browse discounted products in the 'Zachraňte mě' (Save Me / Last Minute) section. These are products near expiry sold at significant discounts. Returns product names, original and sale prices, discount badges, and availability. Great for finding cheap ingredients to cook with.",
      inputSchema: {
        category_id: z.number().optional().describe("Optional category ID to filter (e.g. 300103000 for Maso a ryby). If omitted, returns products across all categories."),
        limit: z.number().min(1).max(100).default(30).describe("Maximum number of products to return (1-100, default: 30)")
      }
    },
    handler: async (args: { category_id?: number; limit?: number }) => {
      const { category_id, limit = 30 } = args;
      try {
        const api = createRohlikAPI();
        const { categories, products } = await api.getLastMinute(category_id, limit);

        // Format category list
        const catList = categories.map((c: any) =>
          `  ${c.id}: ${c.name} (${c.count})`
        ).join('\n');

        // Format products with discount info
        const productLines = products.map((p: any) => {
          const prices = p.prices || {};
          const hasDiscount = prices.salePrice != null && prices.originalPrice != null;
          const priceStr = hasDiscount
            ? `${prices.salePrice} ${prices.currency} (was ${prices.originalPrice})`
            : `${prices.originalPrice || '?'} ${prices.currency || ''}`;

          const badge = p.badges?.find((b: any) => b.position === 'PRICE');
          const discountStr = badge ? ` [${badge.text}]` : '';

          const stock = p.stock?.availabilityStatus === 'AVAILABLE'
            ? '' : ` (${p.stock?.availabilityStatus || 'unknown'})`;

          return `• ${p.name}\n  ${priceStr}${discountStr}${stock}\n  ${p.textualAmount || ''} | ID: ${p.productId}`;
        }).join('\n\n');

        const output = `Last Minute categories:\n${catList}\n\n` +
          `Showing ${products.length} discounted products${category_id ? ` in category ${category_id}` : ''}:\n\n${productLines}`;

        return {
          content: [{
            type: "text" as const,
            text: output
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error)
          }],
          isError: true
        };
      }
    }
  };
}
