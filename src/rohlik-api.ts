import fetch from 'node-fetch';
import { Product, SearchResult, CartContent, RohlikCredentials, RohlikAPIResponse, AccountData } from './types.js';
import { getAcceptLanguage } from './locale.js';

const BASE_URL = process.env.ROHLIK_BASE_URL || 'https://www.rohlik.cz';

export class RohlikAPIError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'RohlikAPIError';
  }
}

export class RohlikAPI {
  private credentials: RohlikCredentials;
  private userId?: number;
  private addressId?: number;
  private sessionCookies: string = '';
  private lastRequestTime: number = 0;
  private readonly minRequestInterval: number = 100; // Minimum 100ms between requests

  constructor(credentials: RohlikCredentials) {
    this.credentials = credentials;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const delay = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }

  private async makeRequest<T>(
    url: string,
    options: Partial<Parameters<typeof fetch>[1]> = {}
  ): Promise<RohlikAPIResponse<T>> {
    // Apply rate limiting to prevent HTTP 429 errors
    await this.rateLimit();

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': getAcceptLanguage(),
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Referer': BASE_URL,
      'Origin': BASE_URL,
      'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      ...(this.sessionCookies && { Cookie: this.sessionCookies }),
      ...(options.headers as Record<string, string> || {})
    };

    const response = await fetch(`${BASE_URL}${url}`, {
      ...options,
      headers
    });

    // Store cookies for session management
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      this.sessionCookies = setCookieHeader;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new RohlikAPIError(`HTTP ${response.status} on ${url}: ${errorBody.slice(0, 300)}`, response.status);
    }

    return await response.json() as RohlikAPIResponse<T>;
  }

  async login(): Promise<void> {
    const loginData = {
      email: this.credentials.username,
      password: this.credentials.password,
      name: ''
    };

    const debug = process.env.ROHLIK_DEBUG === 'true';

    try {
      const response = await this.makeRequest<any>('/services/frontend-service/login', {
        method: 'POST',
        body: JSON.stringify(loginData)
      });

      if (debug) {
        console.error('[ROHLIK_DEBUG] Login response:', JSON.stringify(response, null, 2));
      }

      // Check for various error response formats
      // Accept both 200 (OK) and 202 (Accepted) as successful responses
      const isSuccess = response.status === 200 || response.status === 202 || response.status === undefined;

      if (!isSuccess) {
        if (response.status === 401 || response.status === 403) {
          throw new RohlikAPIError('Invalid credentials - please check your username and password', response.status);
        }

        // Try to extract error message from various possible locations
        const responseAny = response as any;
        const errorMessage =
          response.messages?.[0]?.content ||
          responseAny.message ||
          responseAny.error ||
          `Login failed with status ${response.status}`;

        if (debug) {
          console.error('[ROHLIK_DEBUG] Login failed:', errorMessage);
        }

        throw new RohlikAPIError(`Login failed: ${errorMessage}`, response.status);
      }

      // Verify we have user data
      if (!response.data?.user?.id) {
        if (debug) {
          console.error('[ROHLIK_DEBUG] No user ID in response. Full response:', JSON.stringify(response, null, 2));
        }
        throw new RohlikAPIError('Login succeeded but no user data received. Please check credentials and try again.');
      }

      this.userId = response.data.user.id;
      this.addressId = response.data?.address?.id;

      if (debug) {
        console.error(`[ROHLIK_DEBUG] Login successful. User ID: ${this.userId}, Address ID: ${this.addressId}`);
      }
    } catch (error) {
      if (error instanceof RohlikAPIError) {
        throw error;
      }

      // Log the full error for debugging
      if (debug) {
        console.error('[ROHLIK_DEBUG] Login error:', error);
      }

      // Handle network or other errors
      if (error instanceof Error) {
        throw new RohlikAPIError(`Login failed: ${error.message}`);
      }

      throw new RohlikAPIError('Login failed: Unknown error occurred');
    }
  }

  async logout(): Promise<void> {
    await this.makeRequest('/services/frontend-service/logout', {
      method: 'POST'
    });
    this.sessionCookies = '';
  }

  async searchProducts(
    productName: string,
    limit: number = 10,
    favouriteOnly: boolean = false
  ): Promise<SearchResult[]> {
    await this.login();

    try {
      const searchParams = new URLSearchParams({
        search: productName,
        offset: '0',
        limit: String(limit + 5),
        companyId: '1',
        filterData: JSON.stringify({ filters: [] }),
        canCorrect: 'true'
      });

      const response = await this.makeRequest<any>(`/services/frontend-service/search-metadata?${searchParams}`);
      
      let products = response.data?.productList || [];

      // Remove sponsored content
      products = products.filter((p: any) => 
        !p.badge?.some((badge: any) => badge.slug === 'promoted')
      );

      // Filter favourites if requested
      if (favouriteOnly) {
        products = products.filter((p: any) => p.favourite);
      }

      // Limit results
      products = products.slice(0, limit);

      return products.map((p: any) => ({
        id: p.productId,
        name: p.productName,
        price: `${p.price.full} ${p.price.currency}`,
        brand: p.brand,
        amount: p.textualAmount
      }));
    } finally {
      await this.logout();
    }
  }

  async addToCart(products: Product[]): Promise<number[]> {
    await this.login();

    try {
      const addedProducts: number[] = [];

      for (const product of products) {
        try {
          const payload = {
            actionId: null,
            productId: product.product_id,
            quantity: product.quantity,
            recipeId: null,
            source: 'true:Shopping Lists'
          };

          await this.makeRequest('/services/frontend-service/v2/cart', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          addedProducts.push(product.product_id);
        } catch (error) {
          console.error(`Failed to add product ${product.product_id}:`, error);
        }
      }

      return addedProducts;
    } finally {
      await this.logout();
    }
  }

  async getCartContent(): Promise<CartContent> {
    await this.login();

    try {
      const response = await this.makeRequest<any>('/services/frontend-service/v2/cart');
      const data = response.data || {};

      return {
        total_price: data.totalPrice || 0,
        total_items: Object.keys(data.items || {}).length,
        can_make_order: data.submitConditionPassed || false,
        products: Object.entries(data.items || {}).map(([productId, productData]: [string, any]) => ({
          id: productId,
          cart_item_id: productData.orderFieldId || '',
          name: productData.productName || '',
          quantity: productData.quantity || 0,
          price: productData.price || 0,
          category_name: productData.primaryCategoryName || '',
          brand: productData.brand || ''
        }))
      };
    } finally {
      await this.logout();
    }
  }

  async removeFromCart(orderFieldId: string): Promise<boolean> {
    await this.login();

    try {
      await this.makeRequest(`/services/frontend-service/v2/cart?orderFieldId=${orderFieldId}`, {
        method: 'DELETE'
      });
      return true;
    } catch (error) {
      console.error(`Failed to remove item ${orderFieldId}:`, error);
      return false;
    } finally {
      await this.logout();
    }
  }

  async getShoppingList(shoppingListId: string): Promise<{ name: string; products: any[] }> {
    await this.login();

    try {
      const response = await this.makeRequest<any>(`/api/v1/shopping-lists/id/${shoppingListId}`);
      // Handle both wrapped and direct responses
      const listData = response.data || response;
      return {
        name: listData?.name || 'Unknown List',
        products: listData?.products || []
      };
    } finally {
      await this.logout();
    }
  }

  async getAccountData(): Promise<AccountData> {
    await this.login();

    try {
      const result: AccountData = {};
      
      // Define endpoints similar to the Python implementation
      const endpoints = {
        delivery: '/services/frontend-service/first-delivery?reasonableDeliveryTime=true',
        next_order: '/api/v3/orders/upcoming',
        announcements: '/services/frontend-service/announcements/top',
        bags: '/api/v1/reusable-bags/user-info',
        timeslot: '/services/frontend-service/v1/timeslot-reservation',
        last_order: '/api/v3/orders/delivered?offset=0&limit=1',
        premium_profile: '/services/frontend-service/premium/profile',
        delivery_announcements: '/services/frontend-service/announcements/delivery',
        delivered_orders: '/api/v3/orders/delivered?offset=0&limit=50'
      };

      // Fetch data from all endpoints
      for (const [endpoint, path] of Object.entries(endpoints)) {
        try {
          const response = await this.makeRequest<any>(path);
          (result as any)[endpoint] = response.data || response;
        } catch (error) {
          console.error(`Error fetching ${endpoint}:`, error);
          (result as any)[endpoint] = null;
        }
      }

      // Handle next delivery slot endpoint (requires userId and addressId)
      if (this.userId && this.addressId) {
        try {
          const nextDeliveryPath = `/services/frontend-service/timeslots-api/0?userId=${this.userId}&addressId=${this.addressId}&reasonableDeliveryTime=true`;
          const response = await this.makeRequest<any>(nextDeliveryPath);
          result.next_delivery_slot = response.data || response;
        } catch (error) {
          console.error('Error fetching next_delivery_slot:', error);
          result.next_delivery_slot = null;
        }
      } else {
        result.next_delivery_slot = null;
      }

      // Get cart content (call internal method to avoid double login)
      try {
        const response = await this.makeRequest<any>('/services/frontend-service/v2/cart');
        const data = response.data || {};

        result.cart = {
          total_price: data.totalPrice || 0,
          total_items: Object.keys(data.items || {}).length,
          can_make_order: data.submitConditionPassed || false,
          products: Object.entries(data.items || {}).map(([productId, productData]: [string, any]) => ({
            id: productId,
            cart_item_id: productData.orderFieldId || '',
            name: productData.productName || '',
            quantity: productData.quantity || 0,
            price: productData.price || 0,
            category_name: productData.primaryCategoryName || '',
            brand: productData.brand || ''
          }))
        };
      } catch (error) {
        console.error('Error fetching cart:', error);
        result.cart = undefined;
      }

      return result;
    } finally {
      await this.logout();
    }
  }

  async getOrderHistory(limit: number = 50): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>(`/api/v3/orders/delivered?offset=0&limit=${limit}`);
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async getDeliveryInfo(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>('/services/frontend-service/first-delivery?reasonableDeliveryTime=true');
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async getUpcomingOrders(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>('/api/v3/orders/upcoming');
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async getPremiumInfo(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>('/services/frontend-service/premium/profile');
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async getDeliverySlots(): Promise<any> {
    await this.login();

    try {
      if (this.userId && this.addressId) {
        const response = await this.makeRequest<any>(`/services/frontend-service/timeslots-api/0?userId=${this.userId}&addressId=${this.addressId}&reasonableDeliveryTime=true`);
        return response.data || response;
      } else {
        throw new RohlikAPIError('User ID or Address ID not available');
      }
    } finally {
      await this.logout();
    }
  }

  async getAnnouncements(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>('/services/frontend-service/announcements/top');
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async getReusableBagsInfo(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>('/api/v1/reusable-bags/user-info');
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  // Known last-minute subcategory IDs — these map to standard Rohlik categories
  static readonly LAST_MINUTE_CATEGORIES: { id: number; name: string }[] = [
    { id: 300101000, name: "Pekárna a cukrárna" },
    { id: 300102000, name: "Ovoce a zelenina" },
    { id: 300103000, name: "Maso a ryby" },
    { id: 300104000, name: "Uzeniny a lahůdky" },
    { id: 300105000, name: "Mléčné a chlazené" },
    { id: 300106000, name: "Trvanlivé" },
    { id: 300108000, name: "Nápoje" },
    { id: 300110000, name: "Dítě" },
    { id: 300111000, name: "Domácnost a zahrada" },
    { id: 300112000, name: "Zvíře" },
    { id: 300112393, name: "Speciální výživa" },
    { id: 300121429, name: "Plant Based" },
    { id: 300124206, name: "Kosmetika" },
  ];

  async getLastMinuteCounts(): Promise<{ id: number; name: string; count: number }[]> {
    const results: { id: number; name: string; count: number }[] = [];
    for (const cat of RohlikAPI.LAST_MINUTE_CATEGORIES) {
      try {
        const response = await this.makeRequest<any>(
          `/api/v1/categories/last-minute/${cat.id}/products/count`
        );
        const count = (response as any)?.results ?? (response as any)?.data?.results ?? 0;
        if (count > 0) {
          results.push({ ...cat, count });
        }
      } catch {
        // Category might be empty or unavailable, skip
      }
    }
    return results;
  }

  async getLastMinuteProducts(categoryId: number, page: number = 0, size: number = 14): Promise<{ productIds: number[]; total: number }> {
    const response = await this.makeRequest<any>(
      `/api/v1/categories/last-minute/${categoryId}/products?page=${page}&size=${size}&sort=expiration-asc`
    );
    const data = (response as any);
    return {
      productIds: data.productIds || data.data?.productIds || [],
      total: data.pageable?.offset !== undefined
        ? data.pageable.offset + (data.productIds?.length || 0)
        : (data.productIds?.length || 0)
    };
  }

  async getProductCards(productIds: number[]): Promise<any[]> {
    if (productIds.length === 0) return [];
    // Batch in groups of 50 to avoid URL length limits
    const results: any[] = [];
    for (let i = 0; i < productIds.length; i += 50) {
      const batch = productIds.slice(i, i + 50);
      const params = batch.map(id => `products=${id}`).join('&');
      const response = await this.makeRequest<any>(`/api/v1/products/card?${params}`);
      const products = Array.isArray(response) ? response : (response.data || response);
      if (Array.isArray(products)) {
        results.push(...products);
      }
    }
    return results;
  }

  async getLastMinute(categoryId?: number, limit: number = 30): Promise<{ categories: any[]; products: any[] }> {
    await this.login();

    try {
      // 1. Get categories with counts
      let categories: { id: number; name: string; count: number }[];
      try {
        categories = await this.getLastMinuteCounts();
      } catch (e: any) {
        throw new RohlikAPIError(`Failed to fetch categories: ${e.message}`);
      }

      // 2. Get product IDs from selected category or all
      let allProductIds: number[] = [];
      const targetCategories = categoryId
        ? categories.filter(c => c.id === categoryId)
        : categories;

      for (const cat of targetCategories) {
        try {
          // Page through in standard page sizes of 14
          let page = 0;
          while (allProductIds.length < limit) {
            const { productIds } = await this.getLastMinuteProducts(cat.id, page);
            if (productIds.length === 0) break;
            allProductIds.push(...productIds);
            if (productIds.length < 14) break; // last page
            page++;
          }
          if (allProductIds.length >= limit) break;
        } catch (e: any) {
          throw new RohlikAPIError(`Failed to fetch products for category ${cat.id} (${cat.name}): ${e.message}`);
        }
      }

      allProductIds = allProductIds.slice(0, limit);

      // 3. Get product details
      let products: any[];
      try {
        products = await this.getProductCards(allProductIds);
      } catch (e: any) {
        throw new RohlikAPIError(`Failed to fetch product cards for ${allProductIds.length} products: ${e.message}`);
      }

      return { categories, products };
    } finally {
      await this.logout();
    }
  }

  async checkCart(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>('/services/frontend-service/v2/cart-review/check-cart');
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async updateCartItemQuantity(orderFieldId: string, quantity: number): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>(
        `/services/frontend-service/v2/cart-review/item/${orderFieldId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ quantity })
        }
      );
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async getCheckout(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>('/api/v2/checkout');
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async getSuborderInfo(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>('/services/frontend-service/suborder-info');
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async getTimeslots(cartTotal: number): Promise<any> {
    await this.login();

    try {
      if (!this.userId || !this.addressId) {
        throw new RohlikAPIError('User ID or Address ID not available');
      }
      const response = await this.makeRequest<any>(
        `/services/frontend-service/timeslots-api/${cartTotal}?userId=${this.userId}&addressId=${this.addressId}&reasonableDeliveryTime=false`
      );
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async reserveTimeslot(slotId: number, slotType: string = 'ON_TIME'): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>(
        '/services/frontend-service/v1/timeslot-reservation',
        {
          method: 'POST',
          body: JSON.stringify({ slotId, slotType })
        }
      );
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async selectTimeslot(slotId: number, slotType: string, slotInfo: any): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>(
        '/api/v2/checkout/timeslot',
        {
          method: 'PATCH',
          body: JSON.stringify({ slotId, slotType, valid: true, slotInfo })
        }
      );
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async enableSuborder(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>(
        '/api/v2/checkout/suborder',
        {
          method: 'PATCH',
          body: JSON.stringify({ isSuborder: true })
        }
      );
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async submitOrder(): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>(
        '/api/v2/checkout/submit-web',
        {
          method: 'POST',
          body: JSON.stringify({ agreementList: [] })
        }
      );
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async payWithStoredCard(storedPaymentMethodId: string, brand: string, holderName: string): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>(
        '/services/frontend-service/order-review/payment/adyen-pay',
        {
          method: 'POST',
          body: JSON.stringify({
            adyenPayload: {
              paymentMethod: {
                type: 'scheme',
                storedPaymentMethodId,
                brand,
                holderName
              },
              browserInfo: {
                acceptHeader: '*/*',
                colorDepth: 24,
                language: 'cs-CZ',
                javaEnabled: false,
                screenHeight: 1440,
                screenWidth: 2560,
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                timeZoneOffset: -60
              },
              origin: BASE_URL,
              clientStateDataIndicator: true
            }
          })
        }
      );
      return response.data || response;
    } finally {
      await this.logout();
    }
  }

  async getOrderDetail(orderId: string): Promise<any> {
    await this.login();

    try {
      const response = await this.makeRequest<any>(`/api/v3/orders/${orderId}`);
      return response.data || response;
    } finally {
      await this.logout();
    }
  }
}