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

        const formatSlot = (slot: any): string => {
          const time = slot.timeWindow || slot.time || slot.timeRange ||
            (slot.since && slot.till ? `${slot.since} – ${slot.till}` : 'Unknown time');
          const price = slot.price !== undefined ? `${slot.price} ${getCurrency()}` : 'Free';
          const capacity = slot.timeSlotCapacityDTO?.capacityMessage || slot.capacity || '';
          return `${time} | ${price}${capacity ? ` | ${capacity}` : ''}`;
        };

        const formatSlots = (data: any): string => {
          const sections: string[] = [];

          // Simple array of slots
          if (Array.isArray(data)) {
            return `⏰ AVAILABLE DELIVERY SLOTS:\n\n${data.map((slot, index) =>
              `${index + 1}. ${slot.date || 'Unknown date'} ${formatSlot(slot)}`
            ).join('\n')}`;
          }

          // Express slot
          if (data.expressSlot) {
            const s = data.expressSlot;
            sections.push(`🚀 EXPRESS: ${formatSlot(s)}`);
          }

          // Preselected slots (quick picks)
          if (data.preselectedSlots && Array.isArray(data.preselectedSlots)) {
            const picks = data.preselectedSlots.map((ps: any) => {
              const label = ps.title || 'Slot';
              const sub = ps.subtitle || '';
              const slot = ps.slot;
              if (slot) {
                return `• ${label} ${sub} – ${formatSlot(slot)}`;
              }
              return `• ${label} ${sub}`;
            });
            sections.push(`⭐ QUICK PICKS:\n${picks.join('\n')}`);
          }

          // Day-by-day slots
          if (data.data && Array.isArray(data.data)) {
            for (const day of data.data) {
              const date = day.date || day.day || 'Unknown date';
              const slots = day.slots || day.timeSlots || [];
              if (Array.isArray(slots) && slots.length > 0) {
                const available = slots.filter((s: any) =>
                  s.capacity !== 'RED' && s.timeSlotCapacityDTO?.capacityMessage !== 'Vyprodáno');
                if (available.length > 0) {
                  const lines = available.map((s: any) => `  ${formatSlot(s)}`);
                  sections.push(`📅 ${date} (${available.length}/${slots.length} available):\n${lines.join('\n')}`);
                } else {
                  sections.push(`📅 ${date}: all slots full`);
                }
              }
            }
          }

          if (sections.length === 0) {
            // Truncated fallback — never dump more than 2KB
            const json = JSON.stringify(data, null, 2);
            return `⏰ DELIVERY SLOTS:\n${json.length > 2000 ? json.slice(0, 2000) + '\n... (truncated)' : json}`;
          }

          return `⏰ DELIVERY SLOTS:\n\n${sections.join('\n\n')}`;
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
