#!/usr/bin/env bash
#
# Tier 3: the checks that ONLY a real Arc node can answer.
#
# Arc's porting guide is explicit that a local EVM cannot stand in here:
#
#   "Tools that locally simulate the EVM (such as Foundry's anvil) run a
#    standard EVM, not Arc's, so they cannot reproduce Arc-specific behavior.
#    Features that depend on it (the native-coin precompiles, EIP-7708 Transfer
#    events, and USDC blocklist enforcement) only surface when you test against
#    an Arc RPC endpoint."
#
# `forge test --fork-url` is not enough either: a fork replays Arc's STATE
# inside a standard EVM, so it reproduces storage but not protocol behaviour.
#
# WHY THIS SCRIPT DECODES REVERT REASONS
# --------------------------------------
# "did it revert?" is not a test. After deployment the admin is handed to the
# owner's wallet and the registry holds no balance, so a naive
# `withdraw(blocklisted)` check reverts with NotAdmin or NothingToWithdraw and
# would PASS while never reaching the blocklist at all. Every assertion below
# therefore checks WHICH custom error came back, by 4-byte selector.
#
# Usage:  script/arc-live-checks.sh <deployed-contract-address>

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

RPC="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}"
USDC=0x3600000000000000000000000000000000000000
# Seeded by Arc Testnet: a value transfer to or from this reverts at runtime.
BLOCKLISTED=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
ZERO=0x0000000000000000000000000000000000000000
KEYSTORE=".keystore/arcdeploy"
PWFILE=".keystore/password.txt"

# Custom error selectors (cast sig).
E_ZERO_ADDRESS=0xd92e233d
E_NOTHING_TO_WITHDRAW=0xd0d04f60
E_NOT_ADMIN=0x7bfa4b9f
E_TILE_RESERVED=0x1765b90e
E_TILE_OUT_OF_RANGE=0x0bf7d69f

CONTRACT="${1:-}"
[[ -n "$CONTRACT" ]] || { echo "usage: $0 <contract-address>" >&2; exit 2; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

ADDR=$(cast wallet address --keystore "$KEYSTORE" --password-file "$PWFILE")
ADMIN=$(cast call "$CONTRACT" "admin()(address)" --rpc-url "$RPC" | awk '{print $1}')

pass=0; fail=0
chk() { if [[ "$(lower "$2")" == "$(lower "$3")" ]]; then echo "  PASS  $1"; pass=$((pass+1));
        else echo "  FAIL  $1"; echo "        got:  $2"; echo "        want: $3"; fail=$((fail+1)); fi; }

# Run an eth_call expected to revert; echo the 4-byte error selector.
revert_selector() {
  local out
  out=$(cast call "$@" --rpc-url "$RPC" 2>&1 || true)
  # Foundry surfaces custom errors either decoded by name or as raw hex data.
  if   grep -qi "ZeroAddress"       <<<"$out"; then echo "$E_ZERO_ADDRESS"
  elif grep -qi "NothingToWithdraw" <<<"$out"; then echo "$E_NOTHING_TO_WITHDRAW"
  elif grep -qi "NotAdmin"          <<<"$out"; then echo "$E_NOT_ADMIN"
  elif grep -qi "TileReserved"      <<<"$out"; then echo "$E_TILE_RESERVED"
  elif grep -qi "TileOutOfRange"    <<<"$out"; then echo "$E_TILE_OUT_OF_RANGE"
  else grep -oiE '0x[0-9a-f]{8}' <<<"$out" | head -1 || echo "NO_REVERT:$out"
  fi
}

echo "contract : $CONTRACT"
echo "admin    : $ADMIN"
echo "deployer : $ADDR"
echo

echo "== 1. chain identity =="
chk "chain id is Arc Testnet" "$(cast chain-id --rpc-url "$RPC")" "5042002"

echo
echo "== 2. USDC is one balance seen at two decimals =="
# The fact the whole pricing model rests on, and the one Arc's own gas-and-fees
# page gets wrong in an example (it passes parseUnits("1", 6) as a native value).
NATIVE=$(cast balance "$ADDR" --rpc-url "$RPC")
ERC20=$(cast call "$USDC" "balanceOf(address)(uint256)" "$ADDR" --rpc-url "$RPC" | awk '{print $1}')
echo "  native (18dp) : $NATIVE"
echo "  ERC-20 ( 6dp) : $ERC20"
chk "ERC-20 decimals() is 6" "$(cast call "$USDC" 'decimals()(uint8)' --rpc-url "$RPC" | awk '{print $1}')" "6"
chk "native == ERC-20 x 1e12 (truncating)" "$(python3 -c "print($NATIVE // 10**12)")" "$ERC20"

echo
echo "== 3. the registry answers, and matches the renderer =="
chk "TILE_COUNT"        "$(cast call "$CONTRACT" 'TILE_COUNT()(uint16)' --rpc-url "$RPC" | awk '{print $1}')" "2100"
chk "FIRST_CLAIMABLE"   "$(cast call "$CONTRACT" 'FIRST_CLAIMABLE()(uint16)' --rpc-url "$RPC" | awk '{print $1}')" "309"
chk "tileIdOf(9,6)=309" "$(cast call "$CONTRACT" 'tileIdOf(uint16,uint16)(uint16)' 9 6 --rpc-url "$RPC" | awk '{print $1}')" "309"
chk "tileIdOf(49,41)=2099" "$(cast call "$CONTRACT" 'tileIdOf(uint16,uint16)(uint16)' 49 41 --rpc-url "$RPC" | awk '{print $1}')" "2099"
chk "remainingCount"    "$(cast call "$CONTRACT" 'remainingCount()(uint256)' --rpc-url "$RPC" | awk '{print $1}')" "1791"
chk "price is 0 (gas-only)" "$(cast call "$CONTRACT" 'price()(uint256)' --rpc-url "$RPC" | awk '{print $1}')" "0"

echo
echo "== 4. admin really moved off the throwaway deploy key =="
chk "admin is not the deployer" "$([[ "$(lower "$ADMIN")" == "$(lower "$ADDR")" ]] && echo yes || echo no)" "no"
chk "deployer calling setPrice reverts NotAdmin" \
    "$(revert_selector "$CONTRACT" 'setPrice(uint256)' 1 --from "$ADDR")" "$E_NOT_ADMIN"
chk "deployer calling withdraw reverts NotAdmin" \
    "$(revert_selector "$CONTRACT" 'withdraw(address)' "$ADMIN" --from "$ADDR")" "$E_NOT_ADMIN"

echo
echo "== 5. reserved tiles refused ON CHAIN, with the right reason =="
chk "tile 308 -> TileReserved" \
    "$(revert_selector "$CONTRACT" 'claim(uint16,string)' 308 "x" --from "$ADDR")" "$E_TILE_RESERVED"
chk "tile 0 -> TileReserved" \
    "$(revert_selector "$CONTRACT" 'claim(uint16,string)' 0 "x" --from "$ADDR")" "$E_TILE_RESERVED"
chk "tile 2100 -> TileOutOfRange" \
    "$(revert_selector "$CONTRACT" 'claim(uint16,string)' 2100 "x" --from "$ADDR")" "$E_TILE_OUT_OF_RANGE"

echo
echo "== 6. the zero-address guard fires as ADMIN (not as NotAdmin) =="
# Simulated from the admin address: eth_call needs no signature, so this reaches
# the guard rather than stopping at the access check.
chk "withdraw(0) as admin -> ZeroAddress" \
    "$(revert_selector "$CONTRACT" 'withdraw(address)' "$ZERO" --from "$ADMIN")" "$E_ZERO_ADDRESS"
# With price 0 the registry can never hold a balance, so this is the honest
# outcome and proves the guard order, rather than pretending to test transfer.
chk "withdraw(anyone) as admin -> NothingToWithdraw (registry is empty by design)" \
    "$(revert_selector "$CONTRACT" 'withdraw(address)' "$ADMIN" --from "$ADMIN")" "$E_NOTHING_TO_WITHDRAW"

echo
echo "== 7. Arc's runtime blocklist (the assertion a fork CANNOT make) =="
# Tested directly rather than through withdraw(): with a price of 0 the registry
# holds no balance, so a withdraw would stop at NothingToWithdraw and never
# reach the blocklist. A plain native transfer exercises the protocol rule
# itself, which is what we actually want to prove exists.
BL_OUT=$(cast estimate --from "$ADDR" "$BLOCKLISTED" --value 1 --rpc-url "$RPC" 2>&1 || true)
if grep -qiE "blocklist|blocked|not allowed|revert|execution reverted" <<<"$BL_OUT"; then
  echo "  PASS  a 1-wei native transfer to the blocklisted address is rejected"
  echo "        node said: $(head -c 160 <<<"$BL_OUT" | tr '\n' ' ')"
  pass=$((pass+1))
else
  echo "  FAIL  transfer to the blocklisted address was NOT rejected"
  echo "        got: $(head -c 200 <<<"$BL_OUT")"
  fail=$((fail+1))
fi

# Control: the same transfer to a normal address must be accepted, or the check
# above proves nothing (it could be failing for an unrelated reason).
OK_OUT=$(cast estimate --from "$ADDR" "$ADMIN" --value 1 --rpc-url "$RPC" 2>&1 || true)
if grep -qE "^[0-9]+$" <<<"$(tr -d '[:space:]' <<<"$OK_OUT")"; then
  echo "  PASS  control: the same transfer to a normal address estimates fine ($OK_OUT gas)"
  pass=$((pass+1))
else
  echo "  FAIL  control transfer also failed, so the blocklist result is not meaningful"
  echo "        got: $(head -c 200 <<<"$OK_OUT")"
  fail=$((fail+1))
fi

echo
echo "== 8. fee floor =="
GASPRICE=$(cast gas-price --rpc-url "$RPC")
echo "  info  eth_gasPrice: $GASPRICE wei ($(python3 -c "print($GASPRICE/1e9)") Gwei)"
if [[ "$GASPRICE" -ge 20000000000 ]]; then
  echo "  PASS  suggested gas price is at or above the 20 Gwei floor"; pass=$((pass+1))
else
  echo "  NOTE  suggested price is under 20 Gwei; arc.js lifts it to the floor anyway"
fi

echo
echo "=========================================="
echo " $pass passed, $fail failed"
echo "=========================================="
[[ $fail -eq 0 ]]
