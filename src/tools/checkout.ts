import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { RohlikAPI } from "../rohlik-api.js";
import { verifyTOTP } from "../totp.js";

const TOTP_SECRET = process.env.ROHLIK_TOTP_SECRET;

// Build a deterministic fingerprint of cart contents so we can detect tampering
function cartFingerprint(cart: any): { hash: string; total: number; itemCount: number; summary: string } {
  const items = cart.items || {};
  const total = cart.totalPrice || 0;
  const entries = Object.entries(items)
    .map(([id, item]: [string, any]) => ({
      id,
      name: item.productName || '',
      qty: item.quantity || 0,
      price: item.price || 0
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const hashInput = entries.map(e => `${e.id}:${e.qty}:${e.price}`).join('|');
  const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

  const summary = entries.map(e => `  ${e.qty}× ${e.name} — ${e.price} CZK`).join('\n');

  return { hash, total, itemCount: entries.length, summary };
}

export function createCheckoutTools(createRohlikAPI: () => RohlikAPI) {
  // Pending payment state for stderr mode
  let pendingPayment: {
    code: string;
    storedPaymentMethodId: string;
    brand: string;
    holderName: string;
    cartHash: string;
    cartTotal: number;
    createdAt: number;
  } | null = null;

  // Cart snapshot for TOTP mode (taken when code is first requested)
  let totpCartSnapshot: { hash: string; total: number } | null = null;

  return {
    checkCart: {
      name: "check_cart",
      definition: {
        title: "Check Cart",
        description: "Validate shopping cart and get detailed review with totals, savings, item prices, and whether the minimum order amount is met. Use this before checkout to see the full cart state.",
        inputSchema: {}
      },
      handler: async () => {
        try {
          const api = createRohlikAPI();
          const data = await api.checkCart();

          const items = data.items || {};
          const itemLines = Object.values(items).map((item: any) => {
            const lastMin = item.isLastMinute ? ' [Last Minute]' : '';
            const fav = item.favourite ? ' ★' : '';
            return `• ${item.productName}${fav}${lastMin}\n  ${item.quantity}× ${item.price} ${item.currency} | ${item.textualAmount}\n  Cart item: ${item.orderFieldId}`;
          }).join('\n\n');

          const notAvail = (data.notAvailableItems || []).map((item: any) =>
            `  ⚠ ${item.productName} (ID: ${item.productId})`
          ).join('\n');

          const output = [
            `Cart Review (ID: ${data.cartId}):`,
            `  Total: ${data.totalPrice} CZK`,
            `  Savings: ${data.totalSavings} CZK`,
            `  Minimum order: ${data.minimalOrderPrice} CZK`,
            `  Can submit: ${data.submitConditionPassed ? 'Yes' : 'No'}`,
            `  Free delivery remaining: ${data.freeDeliveryRemainingAmount} CZK`,
            '',
            `Items (${Object.keys(items).length}):`,
            itemLines,
            notAvail ? `\nUnavailable items:\n${notAvail}` : ''
          ].filter(Boolean).join('\n');

          return { content: [{ type: "text" as const, text: output }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      }
    },

    updateCartItem: {
      name: "update_cart_item",
      definition: {
        title: "Update Cart Item Quantity",
        description: "Change the quantity of an item already in the cart. Set quantity to 0 to remove. Use the orderFieldId (cart_item_id) from cart content.",
        inputSchema: {
          order_field_id: z.string().min(1).describe("The order field ID of the item to update"),
          quantity: z.number().min(0).describe("New quantity (0 = remove)")
        }
      },
      handler: async (args: { order_field_id: string; quantity: number }) => {
        try {
          const api = createRohlikAPI();
          const data = await api.updateCartItemQuantity(args.order_field_id, args.quantity);

          const action = args.quantity === 0 ? 'Removed' : `Updated to ${args.quantity}×`;
          const output = `${action} item ${args.order_field_id}.\nNew cart total: ${data.totalPrice} CZK (${Object.keys(data.items || {}).length} items)`;

          return { content: [{ type: "text" as const, text: output }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      }
    },

    getCheckoutStatus: {
      name: "get_checkout_status",
      definition: {
        title: "Get Checkout Status",
        description: "Get the current checkout form status — shows which sections are valid (address, contact, courier, packaging, timeslot, payment). Also checks if a suborder (adding to existing order) is available.",
        inputSchema: {}
      },
      handler: async () => {
        try {
          const api = createRohlikAPI();
          const [checkout, suborderInfo] = await Promise.all([
            api.getCheckout(),
            api.getSuborderInfo().catch(() => null)
          ]);

          const sections = checkout?.checkout?.formSections || {};
          const sectionLines = Object.entries(sections).map(([name, section]: [string, any]) => {
            if (!section?.data) return `  ${name}: not loaded`;
            const d = section.data;
            const status = d.valid ? '✓' : '✗';
            return `  ${status} ${d.title || name}${d.summary ? ': ' + d.summary : ''}`;
          }).join('\n');

          let suborderLine = '';
          if (suborderInfo?.data) {
            const si = suborderInfo.data;
            suborderLine = `\nSuborder available: ${si.basic || 'Yes'}`;
            if (si.disabledReason) suborderLine += ` (disabled: ${si.disabledReason})`;
          } else {
            suborderLine = '\nSuborder: not available (no active order)';
          }

          const output = `Checkout sections:\n${sectionLines}${suborderLine}`;

          return { content: [{ type: "text" as const, text: output }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      }
    },

    getTimeslots: {
      name: "get_timeslots",
      definition: {
        title: "Get Delivery Timeslots",
        description: "Get available delivery time slots for checkout. Shows express option, preselected suggestions, and all available slots grouped by day and hour. Requires the cart total price.",
        inputSchema: {
          cart_total: z.number().min(0).describe("Cart total price in CZK (from check_cart)")
        }
      },
      handler: async (args: { cart_total: number }) => {
        try {
          const api = createRohlikAPI();
          const data = await api.getTimeslots(args.cart_total);

          const lines: string[] = [];

          // Express slot
          if (data.expressSlot) {
            const es = data.expressSlot;
            lines.push(`Express: ${es.timeWindow} (${es.capacity}) ${es.price === 0 ? 'FREE' : es.price + ' CZK'} | ID: ${es.slotId}`);
          }

          // Preselected suggestions
          if (data.preselectedSlots?.length) {
            lines.push('\nSuggested:');
            for (const ps of data.preselectedSlots) {
              const s = ps.slot;
              lines.push(`  ${ps.title} — ${ps.subtitle}: ${s.timeWindow} ${s.price === 0 ? 'FREE' : s.price + ' CZK'} | ID: ${s.slotId}`);
            }
          }

          // Availability days
          if (data.availabilityDays?.length) {
            for (const day of data.availabilityDays) {
              const slots = day.slots || {};
              const slotCount = Object.values(slots).reduce((sum: number, hourSlots: any) =>
                sum + (Array.isArray(hourSlots) ? hourSlots.length : 0), 0);
              if (slotCount === 0) continue;

              lines.push(`\n${day.label || day.date}:`);
              for (const [hour, hourSlots] of Object.entries(slots)) {
                if (!Array.isArray(hourSlots) || hourSlots.length === 0) continue;
                const slotTexts = hourSlots.map((s: any) => {
                  const price = s.price === 0 ? 'FREE' : `${s.price} CZK`;
                  const cap = s.capacity === 'GREEN' ? '' : ` [${s.capacity}]`;
                  return `${s.timeWindow} ${price}${cap} (ID:${s.slotId})`;
                });
                lines.push(`  ${hour}:00 — ${slotTexts.join(' | ')}`);
              }
            }
          }

          return { content: [{ type: "text" as const, text: lines.join('\n') || 'No timeslots available.' }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      }
    },

    reserveTimeslot: {
      name: "reserve_timeslot",
      definition: {
        title: "Reserve Delivery Timeslot",
        description: "Reserve a delivery timeslot by its ID. The reservation lasts 60 minutes. Use get_timeslots first to see available slots.",
        inputSchema: {
          slot_id: z.number().describe("The slot ID to reserve (from get_timeslots)"),
          slot_type: z.string().default("ON_TIME").describe("Slot type: ON_TIME, EXPRESS, or VIRTUAL (default: ON_TIME)")
        }
      },
      handler: async (args: { slot_id: number; slot_type?: string }) => {
        try {
          const api = createRohlikAPI();
          const data = await api.reserveTimeslot(args.slot_id, args.slot_type || 'ON_TIME');

          if (data.active && data.reservationDetail) {
            const rd = data.reservationDetail;
            return { content: [{ type: "text" as const, text: `Reserved: ${rd.dayAndTimeWindow} (expires in ${rd.duration} min)\nSlot ID: ${rd.slotId}` }] };
          }

          return { content: [{ type: "text" as const, text: `Reservation response: ${JSON.stringify(data)}` }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      }
    },

    submitOrder: {
      name: "submit_order",
      definition: {
        title: "Submit Order",
        description: "Submit the current cart as an order. Returns payment methods (stored cards, Apple Pay, Google Pay). IMPORTANT: This initiates the order — make sure the cart is reviewed and timeslot is selected first. Set is_suborder=true to add to an existing active order instead of creating a new one.",
        inputSchema: {
          is_suborder: z.boolean().default(false).describe("Add to existing order instead of creating new one (default: false)")
        }
      },
      handler: async (args: { is_suborder?: boolean }) => {
        try {
          const api = createRohlikAPI();

          // Enable suborder mode if requested
          if (args.is_suborder) {
            await api.enableSuborder();
          }

          const data = await api.submitOrder();

          if (data.status === 'ADYEN_PAYMENT') {
            const payload = data.data?.payload || {};
            const stored = (payload.storedPaymentMethods || []).map((m: any) =>
              `  • ${m.name} ${m.brand} ****${m.lastFour} (${m.holderName}) exp ${m.expiryMonth}/${m.expiryYear} | ID: ${m.id}`
            ).join('\n');

            const methods = (payload.paymentMethods || []).map((m: any) =>
              `  • ${m.name} (${m.type})`
            ).join('\n');

            const output = [
              'Order submitted! Payment required.',
              '',
              stored ? `Stored cards:\n${stored}` : '',
              methods ? `Other methods:\n${methods}` : '',
              '',
              'Use pay_with_card to complete payment with a stored card.'
            ].filter(Boolean).join('\n');

            return { content: [{ type: "text" as const, text: output }] };
          }

          return { content: [{ type: "text" as const, text: `Order status: ${data.status || JSON.stringify(data)}` }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      }
    },

    payWithCard: {
      name: "pay_with_card",
      definition: {
        title: "Pay with Stored Card",
        description: TOTP_SECRET
          ? "Pay with a stored card. Requires a 6-digit TOTP code from the user's authenticator app (Rohlik MCP entry). Ask the user for their current code before calling. NEVER guess or fabricate a TOTP code. The tool verifies the cart has not been modified since confirmation was requested — if anything changed, payment is refused."
          : "Two-step payment with human confirmation. Step 1: call WITHOUT confirmation_code — a code and the cart contents are printed to the server's stderr (visible only in the user's terminal, NOT returned to you). Step 2: ask the user to type the code they see, then call again WITH that code. NEVER guess a code — you cannot see it. The tool verifies the cart has not been modified between steps.",
        inputSchema: {
          stored_payment_method_id: z.string().describe("The stored payment method ID (from submit_order)"),
          brand: z.string().describe("Card brand: mc, visa, etc."),
          holder_name: z.string().describe("Cardholder name as shown on the stored card"),
          confirmation_code: z.string().optional().describe(
            TOTP_SECRET
              ? "The 6-digit TOTP code from the user's authenticator app. Must be provided — payment will not proceed without it."
              : "The 6-character confirmation code the user read from their terminal. You cannot see this code — only the human can provide it."
          )
        }
      },
      handler: async (args: { stored_payment_method_id: string; brand: string; holder_name: string; confirmation_code?: string }) => {
        // ── TOTP mode (claude.ai / headless — no terminal access) ──
        if (TOTP_SECRET) {
          if (!args.confirmation_code) {
            // Snapshot the cart so we can detect tampering at payment time
            try {
              const api = createRohlikAPI();
              const cart = await api.checkCart();
              const fp = cartFingerprint(cart);
              totpCartSnapshot = { hash: fp.hash, total: fp.total };

              return {
                content: [{
                  type: "text" as const,
                  text: [
                    `Payment requires TOTP confirmation.`,
                    `Card: ${args.brand.toUpperCase()} (${args.holder_name})`,
                    ``,
                    `Cart (${fp.itemCount} items, ${fp.total} CZK):`,
                    fp.summary,
                    ``,
                    `Ask the user for the 6-digit code from their authenticator app (Rohlik MCP).`,
                    `Then call pay_with_card again with confirmation_code set to that code.`
                  ].join('\n')
                }]
              };
            } catch (error) {
              return { content: [{ type: "text" as const, text: `Failed to snapshot cart: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
            }
          }

          if (!verifyTOTP(TOTP_SECRET, args.confirmation_code)) {
            return { content: [{ type: "text" as const, text: "Invalid or expired TOTP code. Payment NOT executed. Ask the user for a fresh code." }], isError: true };
          }

          // TOTP valid — re-check cart before paying
          try {
            const api = createRohlikAPI();

            if (totpCartSnapshot) {
              const cart = await api.checkCart();
              const fp = cartFingerprint(cart);
              if (fp.hash !== totpCartSnapshot.hash) {
                const msg = [
                  `PAYMENT REFUSED — cart was modified after confirmation was requested.`,
                  ``,
                  `Cart at confirmation: ${totpCartSnapshot.total} CZK`,
                  `Cart now: ${fp.total} CZK (${fp.itemCount} items):`,
                  fp.summary,
                  ``,
                  `Start the payment process over so the user can review the current cart.`
                ].join('\n');
                totpCartSnapshot = null;
                return { content: [{ type: "text" as const, text: msg }], isError: true };
              }
            }
            totpCartSnapshot = null;

            const data = await api.payWithStoredCard(args.stored_payment_method_id, args.brand, args.holder_name);

            if (data.status === 'COMPLETE') {
              return { content: [{ type: "text" as const, text: `Payment complete! Order confirmed.` }] };
            }

            return { content: [{ type: "text" as const, text: `Payment status: ${data.status || JSON.stringify(data)}` }] };
          } catch (error) {
            totpCartSnapshot = null;
            return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
          }
        }

        // ── Stderr mode (local terminal — code printed to stderr, invisible to LLM) ──

        // Step 1: No code provided — snapshot cart, generate code, print both to stderr
        if (!args.confirmation_code) {
          try {
            const api = createRohlikAPI();
            const cart = await api.checkCart();
            const fp = cartFingerprint(cart);

            const code = randomBytes(3).toString('hex').toUpperCase();
            pendingPayment = {
              code,
              storedPaymentMethodId: args.stored_payment_method_id,
              brand: args.brand,
              holderName: args.holder_name,
              cartHash: fp.hash,
              cartTotal: fp.total,
              createdAt: Date.now()
            };

            // Everything the user needs to verify goes to stderr — LLM never sees it
            console.error(`\n${'='.repeat(50)}`);
            console.error(`  PAYMENT CONFIRMATION`);
            console.error(`  Card: ${args.brand.toUpperCase()} (${args.holder_name})`);
            console.error(`  Cart: ${fp.itemCount} items, ${fp.total} CZK`);
            console.error(fp.summary);
            console.error(`  Code: ${code}`);
            console.error(`  Expires in 5 minutes.`);
            console.error(`${'='.repeat(50)}\n`);

            return {
              content: [{
                type: "text" as const,
                text: [
                  `Payment confirmation initiated.`,
                  `Card: ${args.brand.toUpperCase()} (${args.holder_name})`,
                  ``,
                  `A confirmation code and cart summary have been printed to the server terminal (stderr).`,
                  `Ask the user to verify the cart contents and read the code from their terminal.`,
                  `Then call pay_with_card again with confirmation_code set to what the user provides.`
                ].join('\n')
              }]
            };
          } catch (error) {
            return { content: [{ type: "text" as const, text: `Failed to snapshot cart: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
          }
        }

        // Step 2: Code provided — validate code, re-check cart, then execute
        if (!pendingPayment) {
          return { content: [{ type: "text" as const, text: "No pending payment. Call pay_with_card without confirmation_code first." }], isError: true };
        }

        const codeMatch = pendingPayment.code.length === args.confirmation_code.length &&
          pendingPayment.code.toUpperCase() === args.confirmation_code.toUpperCase();

        if (!codeMatch) {
          pendingPayment = null;
          return { content: [{ type: "text" as const, text: "Invalid confirmation code. Payment NOT executed. Start over." }], isError: true };
        }

        if (Date.now() - pendingPayment.createdAt > 5 * 60 * 1000) {
          pendingPayment = null;
          return { content: [{ type: "text" as const, text: "Confirmation code expired. Start over." }], isError: true };
        }

        if (pendingPayment.storedPaymentMethodId !== args.stored_payment_method_id ||
            pendingPayment.brand !== args.brand ||
            pendingPayment.holderName !== args.holder_name) {
          pendingPayment = null;
          return { content: [{ type: "text" as const, text: "Payment details changed since confirmation. Payment NOT executed. Start over." }], isError: true };
        }

        // Re-fetch cart and compare with snapshot
        const savedHash = pendingPayment.cartHash;
        const savedTotal = pendingPayment.cartTotal;

        // Clear pending before any API calls (one-shot)
        pendingPayment = null;

        try {
          const api = createRohlikAPI();
          const cart = await api.checkCart();
          const fp = cartFingerprint(cart);

          if (fp.hash !== savedHash) {
            console.error(`\n  !! PAYMENT BLOCKED: cart changed since confirmation !!`);
            console.error(`  Was: ${savedTotal} CZK → Now: ${fp.total} CZK\n`);
            return {
              content: [{
                type: "text" as const,
                text: [
                  `PAYMENT REFUSED — cart was modified after confirmation code was issued.`,
                  `Cart at confirmation: ${savedTotal} CZK`,
                  `Cart now: ${fp.total} CZK`,
                  `Start the payment process over.`
                ].join('\n')
              }],
              isError: true
            };
          }

          const data = await api.payWithStoredCard(args.stored_payment_method_id, args.brand, args.holder_name);

          if (data.status === 'COMPLETE') {
            return { content: [{ type: "text" as const, text: `Payment complete! Order confirmed.` }] };
          }

          return { content: [{ type: "text" as const, text: `Payment status: ${data.status || JSON.stringify(data)}` }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      }
    }
  };
}
