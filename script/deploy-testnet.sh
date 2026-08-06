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
