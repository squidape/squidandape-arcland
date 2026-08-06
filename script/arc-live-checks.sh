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
# Everything below therefore sends or reads against the live chain.
#
# Usage:  script/arc-live-checks.sh <deployed-contract-address>

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

RPC="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}"
USDC=0x3600000000000000000000000000000000000000
SYSTEM_EMITTER=0xfffffffffffffffffffffffffffffffffffffffe
# Seeded by Arc Testnet: a value transfer to or from this reverts at runtime.
BLOCKLISTED=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
KEYSTORE=".keystore/arcdeploy"
PWFILE=".keystore/password.txt"

CONTRACT="${1:-}"
[[ -n "$CONTRACT" ]] || { echo "usage: $0 <contract-address>" >&2; exit 2; }

ADDR=$(cast wallet address --keystore "$KEYSTORE" --password-file "$PWFILE")
pass=0; fail=0
chk() { if [[ "$2" == "$3" ]]; then echo "  PASS  $1"; pass=$((pass+1));
        else echo "  FAIL  $1"; echo "        got:  $2"; echo "        want: $3"; fail=$((fail+1)); fi; }

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
if [[ "$ERC20" != "0" ]]; then
  chk "native == ERC-20 x 1e12 (truncating)" "$(python3 -c "print($NATIVE // 10**12)")" "$ERC20"
else
  echo "  SKIP  native/ERC-20 ratio (balance is 0 — fund the account to check)"
fi

echo
echo "== 3. the registry answers =="
chk "TILE_COUNT"       "$(cast call "$CONTRACT" 'TILE_COUNT()(uint16)' --rpc-url "$RPC" | awk '{print $1}')" "2100"
chk "FIRST_CLAIMABLE"  "$(cast call "$CONTRACT" 'FIRST_CLAIMABLE()(uint16)' --rpc-url "$RPC" | awk '{print $1}')" "309"
chk "tileIdOf(9,6)=309" "$(cast call "$CONTRACT" 'tileIdOf(uint16,uint16)(uint16)' 9 6 --rpc-url "$RPC" | awk '{print $1}')" "309"
REMAIN=$(cast call "$CONTRACT" 'remainingCount()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
echo "  info  remaining claimable: $REMAIN"

echo
echo "== 4. reserved tiles are refused ON CHAIN (not just locally) =="
if cast call "$CONTRACT" 'claim(uint16,string)' 308 "should fail" --rpc-url "$RPC" --from "$ADDR" >/dev/null 2>&1; then
  echo "  FAIL  claiming reserved tile 308 succeeded"; fail=$((fail+1))
else
  echo "  PASS  claiming reserved tile 308 reverts"; pass=$((pass+1))
fi
if cast call "$CONTRACT" 'claim(uint16,string)' 2100 "should fail" --rpc-url "$RPC" --from "$ADDR" >/dev/null 2>&1; then
  echo "  FAIL  claiming out-of-range tile 2100 succeeded"; fail=$((fail+1))
else
  echo "  PASS  claiming out-of-range tile 2100 reverts"; pass=$((pass+1))
fi

echo
echo "== 5. Arc's blocklist is enforced at runtime =="
# This is the assertion a fork CANNOT make. withdraw() to the seeded blocklisted
# address must fail even though the contract logic itself is happy.
if cast call "$CONTRACT" 'withdraw(address)' "$BLOCKLISTED" --rpc-url "$RPC" --from "$ADDR" >/dev/null 2>&1; then
  echo "  FAIL  withdraw to the blocklisted address did not revert"; fail=$((fail+1))
else
  echo "  PASS  withdraw to the blocklisted address reverts on chain"; pass=$((pass+1))
fi
if cast call "$CONTRACT" 'withdraw(address)' 0x0000000000000000000000000000000000000000 --rpc-url "$RPC" --from "$ADDR" >/dev/null 2>&1; then
  echo "  FAIL  withdraw to the zero address did not revert"; fail=$((fail+1))
else
  echo "  PASS  withdraw to the zero address reverts"; pass=$((pass+1))
fi

echo
echo "== 6. fee floor =="
GASPRICE=$(cast gas-price --rpc-url "$RPC")
echo "  info  eth_gasPrice: $GASPRICE wei ($(python3 -c "print($GASPRICE/1e9)") Gwei)"
if [[ "$GASPRICE" -ge 20000000000 ]]; then
  echo "  PASS  suggested gas price is at or above the 20 Gwei floor"; pass=$((pass+1))
else
  echo "  NOTE  suggested price is under 20 Gwei; arc.js lifts it to the floor anyway"
fi

echo
echo "== 7. EIP-7708 system Transfer emitter has code =="
CODE=$(cast code "$SYSTEM_EMITTER" --rpc-url "$RPC" | head -c 12)
echo "  info  emitter $SYSTEM_EMITTER code prefix: ${CODE:-0x (none — it is a log-only system address)}"

echo
echo "=========================================="
echo " $pass passed, $fail failed"
echo "=========================================="
[[ $fail -eq 0 ]]
