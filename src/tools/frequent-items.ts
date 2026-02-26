import { z } from "zod";
import { RohlikAPI } from "../rohlik-api.js";

interface ProductFrequency {
  productId: string;
  productName: string;
  brand: string;
  frequency: number;
  totalQuantity: number;
  lastOrderDate?: string;
  averagePrice?: number;
  category?: string;
  categoryId?: number;
}

interface CategoryStats {
  categoryName: string;
  categoryId: number;
  products: ProductFrequency[];
}

export function createFrequentItemsTool(createRohlikAPI: () => RohlikAPI) {
  return {
    name: "get_frequent_items",
    definition: {
      title: "Get Frequent Items",
      description: "Analyze your order history to find the most frequently purchased items",
      inputSchema: {
        orders_to_analyze: z.number().min(1).max(20).default(5).describe("Number of recent orders to analyze (1-20, default: 5)"),
        top_items: z.number().min(3).max(30).default(10).describe("Number of top items to return overall (3-30, default: 10)"),
        top_per_category: z.number().min(1).max(20).default(10).describe("Number of top items to show per category (1-20, default: 10)"),
        show_categories: z.boolean().default(true).describe("Whether to show per-category breakdown (default: true)")
      }
    },
    handler: async (args: { orders_to_analyze?: number; top_items?: number; top_per_category?: number; show_categories?: boolean }) => {
      const { orders_to_analyze = 5, top_items = 10, top_per_category = 10, show_categories = true } = args;

      try {
        const api = createRohlikAPI();

        // Step 1: Get order history
        const orderHistory = await api.getOrderHistory(orders_to_analyze);

        if (!orderHistory || (Array.isArray(orderHistory) && orderHistory.length === 0)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No order history found. You need to have past orders to analyze frequent items."
              }
            ]
          };
        }

        const orders = Array.isArray(orderHistory) ? orderHistory : [orderHistory];

        // Step 2: Get detailed information for each order
        const productMap = new Map<string, ProductFrequency>();
        let processedOrders = 0;
        let totalProducts = 0;

        for (const order of orders) {
          try {
            const orderId = order.id || order.orderNumber;
            if (!orderId) continue;

            const orderDetail = await api.getOrderDetail(String(orderId));
            if (!orderDetail) continue;

            processedOrders++;
            const products = orderDetail.products || orderDetail.items || [];
            const orderDate = orderDetail.deliveredAt || orderDetail.createdAt;

            for (const product of products) {
              const productId = product.productId || product.id;
              const productName = product.productName || product.name;

              if (!productId || !productName) continue;

              totalProducts++;
              const key = `${productId}`;

              // Extract category (use level 1 - mid-level category for grouping)
              const categories = product.categories || [];
              const mainCategory = categories.find((cat: any) => cat.level === 1) || categories[0];
              const categoryName = mainCategory?.name || 'Uncategorized';
              const categoryId = mainCategory?.id || 0;

              if (productMap.has(key)) {
                const existing = productMap.get(key)!;
                existing.frequency++;
                existing.totalQuantity += (product.quantity || 1);

                // Update average price
                if (product.price) {
                  const currentAvg = existing.averagePrice || 0;
                  existing.averagePrice = (currentAvg * (existing.frequency - 1) + product.price) / existing.frequency;
                }

                // Update last order date if newer
                if (orderDate && (!existing.lastOrderDate || orderDate > existing.lastOrderDate)) {
                  existing.lastOrderDate = orderDate;
                }
              } else {
                productMap.set(key, {
                  productId: String(productId),
                  productName,
                  brand: product.brand || '',
                  frequency: 1,
                  totalQuantity: product.quantity || 1,
                  lastOrderDate: orderDate,
                  averagePrice: product.price || 0,
                  category: categoryName,
                  categoryId: categoryId
                });
              }
            }
          } catch (error) {
            // Skip orders that fail to load
            console.error(`Failed to process order: ${error}`);
          }
        }

        // Step 3: Sort by frequency and get top items
        const sortedProducts = Array.from(productMap.values())
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, top_items);

        if (sortedProducts.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Analyzed ${processedOrders} orders but found no products. This might be due to API changes or data format issues.`
              }
            ]
          };
        }

        // Step 4: Group by category
        const categoryMap = new Map<number, CategoryStats>();

        for (const product of Array.from(productMap.values())) {
          const catId = product.categoryId || 0;
          const catName = product.category || 'Uncategorized';

          if (!categoryMap.has(catId)) {
            categoryMap.set(catId, {
              categoryId: catId,
              categoryName: catName,
              products: []
            });
          }

          categoryMap.get(catId)!.products.push(product);
        }

        // Sort products within each category
        for (const category of categoryMap.values()) {
          category.products.sort((a, b) => b.frequency - a.frequency);
        }

        // Step 5: Format output
        const fmtItem = (item: ProductFrequency, i: number, showCat: boolean): string => {
          const price = item.averagePrice ? `${item.averagePrice.toFixed(0)} Kč` : '?';
          const cat = showCat && item.category ? ` [${item.category}]` : '';
          return `${i + 1}. ${item.productName}${cat} — ${item.frequency}x, ~${price}, id:${item.productId}`;
        };

        let output = `Frequent items (${processedOrders} orders, ${totalProducts} products):\n\n`;
        output += sortedProducts.map((item, i) => fmtItem(item, i, true)).join('\n');

        if (show_categories) {
          const sortedCategories = Array.from(categoryMap.values())
            .sort((a, b) => {
              const aTotal = a.products.reduce((sum, p) => sum + p.frequency, 0);
              const bTotal = b.products.reduce((sum, p) => sum + p.frequency, 0);
              return bTotal - aTotal;
            });

          output += '\n\nBy category:';
          for (const category of sortedCategories) {
            const items = category.products.slice(0, top_per_category);
            output += `\n\n${category.categoryName}:`;
            output += '\n' + items.map((item, i) => fmtItem(item, i, false)).join('\n');
          }
        }

        output += '\n\nUse product IDs with add_to_cart to reorder.';

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
