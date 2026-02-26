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
        const data = await api.getDeliverySlots();

        if (!data) {
          return { content: [{ type: "text" as const, text: "No delivery slots available." }] };
        }

        const cur = getCurrency();
        const fmtSlot = (s: any): string => {
          const time = s.timeWindow || (s.since && s.till ? `${s.since}–${s.till}` : '?');
          const price = s.price !== undefined ? `${s.price} ${cur}` : 'free';
          const cap = s.timeSlotCapacityDTO?.capacityMessage || '';
          return `${time}, ${price}${cap ? ` (${cap})` : ''}`;
        };

        const lines: string[] = [];

        // Simple array
        if (Array.isArray(data)) {
          lines.push('Available slots:');
          for (const s of data.slice(0, 20)) {
            lines.push(`  ${s.date || ''} ${fmtSlot(s)}`);
          }
          if (data.length > 20) lines.push(`  ... and ${data.length - 20} more`);
          return { content: [{ type: "text" as const, text: lines.join('\n') }] };
        }

        // Express
        if (data.expressSlot) {
          lines.push(`Express: ${fmtSlot(data.expressSlot)}`);
        }

        // Preselected / quick picks
        if (data.preselectedSlots && Array.isArray(data.preselectedSlots)) {
          for (const ps of data.preselectedSlots) {
            const label = [ps.title, ps.subtitle].filter(Boolean).join(' ');
            lines.push(`${label}: ${ps.slot ? fmtSlot(ps.slot) : 'unavailable'}`);
          }
        }

        // Day-by-day — show up to 5 days, up to 6 slots per day
        if (data.data && Array.isArray(data.data)) {
          let daysShown = 0;
          for (const day of data.data) {
            if (daysShown >= 5) {
              lines.push(`... and ${data.data.length - 5} more days`);
              break;
            }
            const date = day.date || day.day || '?';
            const slots = day.slots || day.timeSlots || [];
            if (!Array.isArray(slots) || slots.length === 0) continue;

            const available = slots.filter((s: any) =>
              s.capacity !== 'RED' && s.timeSlotCapacityDTO?.capacityMessage !== 'Vyprodáno');

            if (available.length === 0) {
              lines.push(`${date}: all slots full`);
            } else {
              lines.push(`${date} (${available.length}/${slots.length} available):`);
              for (const s of available.slice(0, 6)) {
                lines.push(`  ${fmtSlot(s)}`);
              }
              if (available.length > 6) lines.push(`  ... +${available.length - 6} more`);
            }
            daysShown++;
          }
        }

        if (lines.length === 0) {
          lines.push('Delivery slots data returned but no recognizable slots found.');
        }

        return { content: [{ type: "text" as const, text: lines.join('\n') }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        };
      }
    }
  };
}
