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
        const d = await api.getAccountData();

        const sections: string[] = [];
        const cur = getCurrency();

        // Cart summary
        if (d.cart) {
          sections.push(`Cart: ${d.cart.total_items} items, ${d.cart.total_price} ${cur}, can order: ${d.cart.can_make_order ? 'yes' : 'no'}`);
        }

        // Delivery
        if (d.delivery) {
          const del = d.delivery;
          const type = del.deliveryType || 'unknown';
          const text = del.firstDeliveryText?.default || '';
          const addr = del.deliveryLocationText || '';
          sections.push(`Delivery: ${type} (${text})${addr ? `, ${addr}` : ''}`);
        }

        // Express slot
        if (d.next_delivery_slot?.expressSlot) {
          const s = d.next_delivery_slot.expressSlot;
          const time = s.timeWindow || `${s.since}–${s.till}`;
          const cap = s.timeSlotCapacityDTO?.capacityMessage || '';
          sections.push(`Express: ${time}, ${s.price ?? 0} ${cur}${cap ? ` (${cap})` : ''}`);
        }

        // Upcoming order
        if (d.next_order && !Array.isArray(d.next_order)) {
          const o = d.next_order;
          sections.push(`Upcoming order: #${o.id || 'unknown'}`);
        } else {
          sections.push('Upcoming order: none');
        }

        // Last order
        if (d.last_order) {
          const orders = Array.isArray(d.last_order) ? d.last_order : [d.last_order];
          if (orders.length > 0) {
            const o = orders[0];
            const total = o.priceComposition?.total?.amount;
            const date = o.orderTime ? new Date(o.orderTime).toLocaleDateString() : 'unknown';
            sections.push(`Last order: #${o.id || 'unknown'}, ${o.itemsCount || '?'} items, ${total ?? '?'} ${cur}, ${date}`);
          }
        }

        // Premium
        if (d.premium_profile) {
          const p = d.premium_profile;
          const nextPayment = p.prices?.find((pr: any) => pr.label)?.label || '';
          sections.push(`Premium: active${nextPayment ? ` (${nextPayment})` : ''}`);
        }

        // Announcements
        const anns = d.announcements?.announcements;
        if (anns && Array.isArray(anns) && anns.length > 0) {
          sections.push(`Announcements: ${anns.map((a: any) => a.text || a.title || JSON.stringify(a)).join('; ')}`);
        }

        // Bags
        if (d.bags) {
          const b = d.bags;
          sections.push(`Reusable bags: ${b.current ?? '?'}/${b.max ?? '?'}`);
        }

        return {
          content: [{
            type: "text" as const,
            text: sections.length > 0 ? sections.join('\n') : 'No account data available'
          }]
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
