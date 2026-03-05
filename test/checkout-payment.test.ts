import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCheckoutTools } from '../src/tools/checkout.js';
import { generateSecret, generateTOTP, verifyTOTP } from '../src/totp.js';

// Stable cart fixture
const CART_DATA = {
  totalPrice: 500,
  items: {
    '1001': { productName: 'Milk', quantity: 2, price: 30, currency: 'CZK' },
    '1002': { productName: 'Bread', quantity: 1, price: 25, currency: 'CZK' }
  }
};

// Cart with an extra item (simulates tampering)
const TAMPERED_CART = {
  totalPrice: 5500,
  items: {
    ...CART_DATA.items,
    '9999': { productName: 'Expensive Wine', quantity: 10, price: 500, currency: 'CZK' }
  }
};

function mockApiFactory(opts: { payResult?: any; cartSequence?: any[] } = {}) {
  const calls: string[] = [];
  let cartCallIndex = 0;
  const carts = opts.cartSequence || [CART_DATA];

  return {
    calls,
    factory: () => ({
      checkCart: async () => {
        calls.push('checkCart');
        const cart = carts[Math.min(cartCallIndex, carts.length - 1)];
        cartCallIndex++;
        return cart;
      },
      payWithStoredCard: async (id: string, brand: string, name: string) => {
        calls.push(`pay:${id}:${brand}:${name}`);
        return opts.payResult || { status: 'COMPLETE' };
      }
    })
  };
}

describe('pay_with_card — stderr mode (no TOTP)', () => {
  const origSecret = process.env.ROHLIK_TOTP_SECRET;
  beforeEach(() => { delete process.env.ROHLIK_TOTP_SECRET; });
  afterEach(() => { if (origSecret) process.env.ROHLIK_TOTP_SECRET = origSecret; });

  it('step 1: prints code and cart to stderr, not to response', async () => {
    const mod = await import('../src/tools/checkout.js');
    const mock = mockApiFactory();
    const tools = mod.createCheckoutTools(mock.factory as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await tools.payWithCard.handler({
      stored_payment_method_id: 'X', brand: 'mc', holder_name: 'Alice'
    });

    expect(r.isError).toBeUndefined();
    const text = r.content[0].text;
    expect(text).toContain('stderr');

    const stderr = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    // Code in stderr
    const codeMatch = stderr.match(/Code:\s+([A-F0-9]{6})/);
    expect(codeMatch).toBeTruthy();
    expect(text).not.toContain(codeMatch![1]);
    // Cart summary in stderr
    expect(stderr).toContain('500 CZK');
    expect(stderr).toContain('Milk');
    expect(stderr).toContain('Bread');

    errSpy.mockRestore();
  });

  it('step 2: correct code + unchanged cart = payment succeeds', async () => {
    const mod = await import('../src/tools/checkout.js');
    // Both checkCart calls return same data
    const mock = mockApiFactory({ cartSequence: [CART_DATA, CART_DATA] });
    const tools = mod.createCheckoutTools(mock.factory as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await tools.payWithCard.handler({
      stored_payment_method_id: 'C1', brand: 'visa', holder_name: 'Bob'
    });

    const code = errSpy.mock.calls.map(c => c.join(' ')).join('\n').match(/Code:\s+([A-F0-9]{6})/)![1];

    const r = await tools.payWithCard.handler({
      stored_payment_method_id: 'C1', brand: 'visa', holder_name: 'Bob',
      confirmation_code: code
    });

    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('Payment complete');
    expect(mock.calls).toContain('pay:C1:visa:Bob');

    vi.restoreAllMocks();
  });

  it('step 2: cart tampered between steps = payment REFUSED', async () => {
    const mod = await import('../src/tools/checkout.js');
    // First checkCart returns normal cart, second returns tampered
    const mock = mockApiFactory({ cartSequence: [CART_DATA, TAMPERED_CART] });
    const tools = mod.createCheckoutTools(mock.factory as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await tools.payWithCard.handler({
      stored_payment_method_id: 'C1', brand: 'mc', holder_name: 'Alice'
    });

    const code = errSpy.mock.calls.map(c => c.join(' ')).join('\n').match(/Code:\s+([A-F0-9]{6})/)![1];

    const r = await tools.payWithCard.handler({
      stored_payment_method_id: 'C1', brand: 'mc', holder_name: 'Alice',
      confirmation_code: code
    });

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('REFUSED');
    expect(r.content[0].text).toContain('modified');
    // Must NOT have called payWithStoredCard
    expect(mock.calls.filter(c => c.startsWith('pay:'))).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it('wrong code rejects and clears state', async () => {
    const mod = await import('../src/tools/checkout.js');
    const mock = mockApiFactory();
    const tools = mod.createCheckoutTools(mock.factory as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await tools.payWithCard.handler({
      stored_payment_method_id: 'X', brand: 'mc', holder_name: 'Alice'
    });

    const r = await tools.payWithCard.handler({
      stored_payment_method_id: 'X', brand: 'mc', holder_name: 'Alice',
      confirmation_code: 'ZZZZZZ'
    });

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Invalid');

    // State cleared — code attempt on empty state
    const r2 = await tools.payWithCard.handler({
      stored_payment_method_id: 'X', brand: 'mc', holder_name: 'Alice',
      confirmation_code: 'AAAAAA'
    });
    expect(r2.isError).toBe(true);
    expect(r2.content[0].text).toContain('No pending');

    vi.restoreAllMocks();
  });

  it('payment detail swap rejects', async () => {
    const mod = await import('../src/tools/checkout.js');
    const mock = mockApiFactory();
    const tools = mod.createCheckoutTools(mock.factory as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await tools.payWithCard.handler({
      stored_payment_method_id: 'ORIGINAL', brand: 'mc', holder_name: 'Alice'
    });

    const code = errSpy.mock.calls.map(c => c.join(' ')).join('\n').match(/Code:\s+([A-F0-9]{6})/)![1];

    const r = await tools.payWithCard.handler({
      stored_payment_method_id: 'SWAPPED', brand: 'mc', holder_name: 'Alice',
      confirmation_code: code
    });

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('changed');

    vi.restoreAllMocks();
  });

  it('code is one-shot — cannot reuse', async () => {
    const mod = await import('../src/tools/checkout.js');
    const mock = mockApiFactory({ cartSequence: [CART_DATA, CART_DATA] });
    const tools = mod.createCheckoutTools(mock.factory as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await tools.payWithCard.handler({
      stored_payment_method_id: 'C', brand: 'mc', holder_name: 'Eve'
    });

    const code = errSpy.mock.calls.map(c => c.join(' ')).join('\n').match(/Code:\s+([A-F0-9]{6})/)![1];

    // First use
    await tools.payWithCard.handler({
      stored_payment_method_id: 'C', brand: 'mc', holder_name: 'Eve',
      confirmation_code: code
    });

    // Second use — rejected
    const r = await tools.payWithCard.handler({
      stored_payment_method_id: 'C', brand: 'mc', holder_name: 'Eve',
      confirmation_code: code
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('No pending');

    vi.restoreAllMocks();
  });
});

describe('pay_with_card — TOTP verification', () => {
  it('valid TOTP code passes', () => {
    const secret = generateSecret();
    const code = generateTOTP(secret);
    expect(verifyTOTP(secret, code)).toBe(true);
  });

  it('wrong TOTP code fails', () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, '000000')).toBe(false);
    expect(verifyTOTP(secret, '999999')).toBe(false);
  });

  it('code from different secret fails', () => {
    const s1 = generateSecret();
    const s2 = generateSecret();
    expect(verifyTOTP(s1, generateTOTP(s2))).toBe(false);
  });
});
