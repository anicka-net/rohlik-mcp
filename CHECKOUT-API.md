# Rohlik Checkout API Reference

Captured from live browser sessions 2026-03-04.

## Flow Overview

### Normal Order
1. `GET /services/frontend-service/v2/cart-review/check-cart` — validate cart, get totals
2. `GET /api/v2/checkout` — get checkout form (address, contact, courier, packaging, timeslot, payment sections)
3. `GET /services/frontend-service/timeslots-api/{cartTotal}?userId=X&addressId=Y&reasonableDeliveryTime=false` — get available delivery slots
4. `POST /services/frontend-service/v1/timeslot-reservation` — reserve a slot `{"slotId": N, "slotType": "ON_TIME"}`
5. `PATCH /api/v2/checkout/timeslot` — confirm timeslot selection with slot info
6. `POST /api/v2/checkout/submit-web` — submit order `{"agreementList": []}` → returns `"status": "ADYEN_PAYMENT"` with payment methods
7. `POST /services/frontend-service/order-review/payment/adyen-pay` — complete payment with stored card

### Suborder (Add to Existing Order)
1. `GET /services/frontend-service/suborder-info` — check if suborder is available (has active order with deadline)
2. `GET /services/frontend-service/v2/cart-review/check-cart` — validate cart
3. `GET /api/v2/checkout` — get checkout form
4. `PATCH /api/v2/checkout/suborder` — switch to suborder mode `{"isSuborder": true}` (all sections become auto-valid)
5. `POST /api/v2/checkout/submit-web` — submit `{"agreementList": []}` → ADYEN_PAYMENT
6. `POST /services/frontend-service/order-review/payment/adyen-pay` — pay with stored card

## Endpoints

### Cart Review
- `GET /services/frontend-service/v2/cart-review/check-cart` — returns cart with totals
  - Response: `{cartId, totalPrice, totalSavings, minimalOrderPrice, submitConditionPassed, items: {productId: {...}}, notAvailableItems: [...]}`
  - Items keyed by productId, each has: `{productId, orderFieldId, productName, quantity, price, currency, textualAmount, favourite, isLastMinute, ...}`

- `PUT /services/frontend-service/v2/cart-review/item/{orderFieldId}` — change item quantity
  - Request: `{"quantity": N}` (0 = remove)
  - Response: full cart review data

- `POST /services/frontend-service/v2/cart-review/check-cart` — same as GET, triggers price recalculation

### Checkout Form
- `GET /api/v2/checkout` — returns full form with sections
  - Response: `{checkout: {formSections: {addressSection, contactSection, courierSection, packagingSection, timeslotSection, paymentSection}}}`
  - Each section has: `{data: {valid, mandatory, title, summary, ...section-specific-fields}}`

- `PATCH /api/v2/checkout/contact` — update contact info
  - Request: `{name, phone, email, useCompanyContact, companyContact}`

- `PATCH /api/v2/checkout/timeslot` — confirm timeslot
  - Request: `{slotId, slotType, valid, slotInfo: {expressAvailable, ecoAvailable, availableSlots, firstAvailableSlot, selected: {...}}}`

- `PATCH /api/v2/checkout/suborder` — switch to suborder
  - Request: `{"isSuborder": true}`

### Timeslots
- `GET /services/frontend-service/timeslots-api/{cartTotal}?userId=X&addressId=Y&reasonableDeliveryTime=false`
  - Response: `{expressSlot, preselectedSlots: [...], availabilityDays: [{date, label, hasEcoSlot, slots: {hourKey: [slot, ...]}}], ...}`
  - Slot: `{slotId, type, since, till, premium, eco, capacity, price, timeWindow, interval: {since, till}, slotInfo: {...}}`
  - `capacity`: GREEN/YELLOW/RED
  - Slots grouped by hour key (e.g., "6", "7", "8")

- `POST /services/frontend-service/v1/timeslot-reservation` — reserve slot
  - Request: `{"slotId": N, "slotType": "ON_TIME"}`
  - Response: `{active: true, reservationDetail: {slotId, slotType, dayAndTimeWindow, duration, ...}}`

- `DELETE /services/frontend-service/v1/timeslot-reservation` — release reservation

### Suborder Info
- `GET /services/frontend-service/suborder-info`
  - Response (when available): `{data: {title, basic: "Do zítra 04:20 můžete...", full, mergeActive, disabledReason}}`
  - Response (no order): `{data: null}` (45 bytes)

### Order Submission
- `POST /api/v2/checkout/submit-web`
  - Request: `{"agreementList": []}`
  - Response: `{data: {status: "ADYEN_PAYMENT", data: {payload: {paymentMethods: [...], storedPaymentMethods: [...]}}}}`
  - Payment methods: scheme (card), applepay, paywithgoogle
  - Stored methods: `{id, brand, lastFour, holderName, expiryMonth, expiryYear, type: "scheme"}`

### Payment
- `POST /services/frontend-service/order-review/payment/adyen-pay`
  - Request: `{adyenPayload: {paymentMethod: {type: "scheme", storedPaymentMethodId: "...", brand, holderName}, browserInfo: {...}, origin, clientStateDataIndicator}}`
  - Response: `{data: {status: "COMPLETE", data: {userId, payload: {resultCode: "Authorised", ...}}}}`

### Premium Info
- `GET /api/v1/premium/checkout` — premium benefits at checkout
