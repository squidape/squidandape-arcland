#!/usr/bin/env bash
#
# Deploy ArcLandRegistry to Arc Testnet and verify it on ArcScan.
#
# Key handling follows Circle's own `use-arc` skill, which makes this a Security
# Rule rather than a preference:
#
#   "NEVER pass private keys as plain-text CLI flags in deployed environments,
#    including testnet and staging. Prefer encrypted keystores or interactive
#    import (e.g. Foundry's `cast wallet import`)."
#
# So this uses the encrypted keystore in .keystore/ (gitignored) and never the
# --private-key flag, even though Arc's own deploy tutorial shows that flag.
#
# Usage:  script/deploy-testnet.sh [initial-price-wei]
#
# The price is in 18-decimal NATIVE USDC (msg.value), not the 6-decimal ERC-20
# view. Default 0: a claim then costs only gas, which on Arc is itself USDC.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

RPC="${ARC_TESTNET_RPC_URL:-https://rpc.testnet.arc.io}"
CHAIN_ID=5042002
KEYSTORE=".keystore/arcdeploy"
PWFILE=".keystore/password.txt"
PRICE="${1:-0}"

# The deployer is a throwaway key generated on this machine, and its password
# sits in a file because the deploy is non-interactive. It should therefore hold
# no lasting authority over the contract. Immediately after deploying, admin is
# handed to the owner's real wallet (Rabby), which is the only thing that can
# afterwards call setPrice or withdraw.
ADMIN="${ARC_ADMIN:-0x8E978e06156bB88d993C186C0A355f2AB5AFb969}"

for f in "$KEYSTORE" "$PWFILE"; do
  [[ -f "$f" ]] || { echo "error: missing $f — create it with:" >&2
                     echo "  cast wallet new .keystore arcdeploy" >&2; exit 2; }
done

ADDR=$(cast wallet address --keystore "$KEYSTORE" --password-file "$PWFILE")
echo "deployer : $ADDR"

# Confirm we are actually on Arc before spending anything.
GOT=$(cast chain-id --rpc-url "$RPC")
[[ "$GOT" == "$CHAIN_ID" ]] || { echo "error: RPC reports chain $GOT, expected $CHAIN_ID" >&2; exit 1; }
echo "chain    : $GOT (Arc Testnet)"

BAL=$(cast balance "$ADDR" --rpc-url "$RPC")
echo "balance  : $BAL wei ($(cast to-unit "$BAL" ether) USDC, 18-decimal native view)"
if [[ "$BAL" == "0" ]]; then
  cat >&2 <<EOF

error: the deployer has no USDC, so it cannot pay gas.

  Fund it at https://faucet.circle.com — select "Arc Testnet" and paste:

      $ADDR

EOF
  exit 1
fi

echo
echo "deploying ArcLandRegistry(price=$PRICE) ..."
OUT=$(forge create src/ArcLandRegistry.sol:ArcLandRegistry \
  --rpc-url "$RPC" \
  --keystore "$KEYSTORE" --password-file "$PWFILE" \
  --broadcast \
  --constructor-args "$PRICE" 2>&1)
echo "$OUT"

CONTRACT=$(echo "$OUT" | sed -n 's/^Deployed to: //p' | tr -d '[:space:]')
[[ -n "$CONTRACT" ]] || { echo "error: could not parse the deployed address" >&2; exit 1; }

# macOS ships bash 3.2, which has no ${var,,}. Lowercase via tr instead.
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Hand over admin BEFORE anything else, so the throwaway deploy key holds
# authority for as short a window as possible.
if [[ -n "$ADMIN" && "$(lower "$ADMIN")" != "$(lower "$ADDR")" ]]; then
  echo
  echo "handing admin to $ADMIN ..."
  cast send "$CONTRACT" "transferAdmin(address)" "$ADMIN" \
    --rpc-url "$RPC" \
    --keystore "$KEYSTORE" --password-file "$PWFILE" \
    >/dev/null
  NEW_ADMIN=$(cast call "$CONTRACT" "admin()(address)" --rpc-url "$RPC" | awk '{print $1}')
  if [[ "$(lower "$NEW_ADMIN")" == "$(lower "$ADMIN")" ]]; then
    echo "  admin is now $NEW_ADMIN"
    echo "  the deploy key can no longer call setPrice or withdraw"
  else
    echo "error: admin is $NEW_ADMIN, expected $ADMIN" >&2
    exit 1
  fi
fi

echo
echo "verifying on ArcScan (Blockscout) ..."
forge verify-contract "$CONTRACT" src/ArcLandRegistry.sol:ArcLandRegistry \
  --chain-id "$CHAIN_ID" \
  --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api/ \
  --constructor-args "$(cast abi-encode 'constructor(uint256)' "$PRICE")" || \
  echo "note: verification failed; submit manually at https://testnet.arcscan.app/contract-verification"

echo
echo "=========================================================="
echo " contract : $CONTRACT"
echo " explorer : https://testnet.arcscan.app/address/$CONTRACT"
echo "=========================================================="
echo
echo "Now paste that address into ARC_CONTRACT in:"
echo "  /Users/z/claudecode/lim-landbank/website/arc.js"
echo "then run: /Users/z/claudecode/lim-landbank/scripts/sync-bitcoin-land.sh"
