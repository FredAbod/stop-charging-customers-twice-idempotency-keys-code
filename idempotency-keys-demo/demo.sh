#!/usr/bin/env bash
# Run `npm start` in another terminal first.
API=http://localhost:3000
PROVIDER=http://localhost:4000
new_order() { curl -s -X POST $API/orders -H "Content-Type: application/json" -d '{"amount":500000,"currency":"NGN"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id'; }
charges_for() { echo "Charges for $1: $(curl -s "$PROVIDER/v1/charges?orderId=$1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).count')"; }

echo "== 1. Naive payment (new key every attempt), slow network on first try =="
ORDER=$(new_order)
curl -s -X POST "$PROVIDER/__test/slow?times=1" > /dev/null
curl -s -X POST $API/orders/$ORDER/pay-naive; echo
charges_for $ORDER

echo "== 2. Fixed payment (one key per order), same slow network =="
ORDER=$(new_order)
curl -s -X POST "$PROVIDER/__test/slow?times=1" > /dev/null
curl -s -X POST $API/orders/$ORDER/pay; echo
charges_for $ORDER

echo "== 3. User double-clicks Pay =="
curl -s -X POST $API/orders/$ORDER/pay; echo
charges_for $ORDER

echo "== 4. Same key, different amount (someone reused a key) =="
KEY=$(curl -s $API/orders/$ORDER | node -pe 'JSON.parse(require("fs").readFileSync(0)).paymentKey')
curl -s -i -X POST $PROVIDER/v1/charges -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" \
  -d "{\"orderId\":\"$ORDER\",\"amount\":999,\"currency\":\"NGN\"}" | head -1

echo "== 5. Unknown order =="
curl -s -X POST $API/orders/ord_nope/pay; echo

echo "== 6. Provider charges the card, THEN crashes with a 500 =="
ORDER=$(new_order)
curl -s -X POST "$PROVIDER/__test/crash?times=1" > /dev/null
curl -s -X POST $API/orders/$ORDER/pay; echo
echo "Customer clicks Pay again:"
curl -s -X POST $API/orders/$ORDER/pay; echo
echo "We check what really happened:"
curl -s -X POST $API/orders/$ORDER/reconcile; echo
charges_for $ORDER

echo "== 7. Provider crashes with a 500 BEFORE charging =="
ORDER=$(new_order)
curl -s -X POST "$PROVIDER/__test/crash?times=1&charged=no" > /dev/null
curl -s -X POST $API/orders/$ORDER/pay; echo
echo "We check what really happened:"
curl -s -X POST $API/orders/$ORDER/reconcile; echo
echo "Customer clicks Pay again (new key now):"
curl -s -X POST $API/orders/$ORDER/pay; echo
charges_for $ORDER
