import { RohlikAPI } from "../rohlik-api.js";
import { getCurrency } from "../locale.js";

export function createAccountDataTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_account_data",
    definition: {
      title: "Get Account Data",
      description: "Get comprehensive account information including delivery details, orders, announcements, cart, and more",
      inputSchema: {}
    },
    handler: async () => {
      try {
        const api = createRohlikAPI();
        const accountData = await api.getAccountData();

        const formatSection = (title: string, data: any): string => {
          if (!data || (Array.isArray(data) && data.length === 0)) {
            return `${title}: No data available`;
          }
          if (typeof data === 'object') {
            const json = JSON.stringify(data, null, 2);
            // Cap each section to avoid oversized responses
            return `${title}: ${json.length > 1500 ? json.slice(0, 1500) + '\n... (truncated)' : json}`;
          }
          return `${title}: ${String(data)}`;
        };

        const sections: string[] = [];

        // Cart summary
        if (accountData.cart) {
          sections.push(`🛒 CART SUMMARY:
• Total items: ${accountData.cart.total_items}
• Total price: ${accountData.cart.total_price} ${getCurrency()}
• Can order: ${accountData.cart.can_make_order ? 'Yes' : 'No'}`);
        }

        // Delivery info
        if (accountData.delivery) {
          sections.push(formatSection("🚚 DELIVERY INFO", accountData.delivery));
        }

        // Next delivery slot
        if (accountData.next_delivery_slot) {
          sections.push(formatSection("⏰ NEXT DELIVERY SLOT", accountData.next_delivery_slot));
        }

        // Orders
        if (accountData.next_order) {
          sections.push(formatSection("📦 UPCOMING ORDER", accountData.next_order));
        }
        
        if (accountData.last_order) {
          sections.push(formatSection("📋 LAST ORDER", accountData.last_order));
        }

        // Premium profile
        if (accountData.premium_profile) {
          sections.push(formatSection("⭐ PREMIUM PROFILE", accountData.premium_profile));
        }

        // Announcements
        if (accountData.announcements) {
          sections.push(formatSection("📢 ANNOUNCEMENTS", accountData.announcements));
        }

        // Reusable bags
        if (accountData.bags) {
          sections.push(formatSection("♻️ REUSABLE BAGS", accountData.bags));
        }

        const output = sections.length > 0 
          ? sections.join('\n\n') 
          : 'No account data available';

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