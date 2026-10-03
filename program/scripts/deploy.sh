#!/usr/bin/env bash
# Build and deploy the GoodCall router.
#   ./scripts/deploy.sh devnet            first deploy to devnet (do this first)
#   ./scripts/deploy.sh mainnet           deploy to mainnet (set MAINNET_RPC to your own RPC)
#   ./scripts/deploy.sh mainnet --fresh   use a new program address
#   SBF_ARCH=v0 ./scripts/deploy.sh ...   build for a different SBF version (default v3)
#
# Needs: Solana CLI (with cargo build-sbf) and a funded deployer wallet set via
# `solana config set --keypair <file>`. That wallet becomes the program's upgrade authority.
set -euo pipefail

CLUSTER=${1:-}
FRESH=${2:-}
case "$CLUSTER" in
  devnet)  URL=https://api.devnet.solana.com ;;
  mainnet) URL=${MAINNET_RPC:-https://api.mainnet-beta.solana.com} ;;
  *) echo "usage: $0 devnet|mainnet [--fresh]"; exit 1 ;;
esac

cd "$(dirname "$0")/.."
KEY=target/deploy/goodcall_router-keypair.json
mkdir -p target/deploy
if [[ "$FRESH" == "--fresh" || ! -f "$KEY" ]]; then
  solana-keygen new --no-bip39-passphrase --silent --force -o "$KEY"
fi
ID=$(solana-keygen pubkey "$KEY")

# Point declare_id! and Anchor.toml at this program address.
sed -i.bak -E "s/declare_id!\(\"[1-9A-HJ-NP-Za-km-z]+\"\)/declare_id!(\"$ID\")/" programs/goodcall-router/src/lib.rs
sed -i.bak -E "s/^goodcall_router = \".*\"/goodcall_router = \"$ID\"/" Anchor.toml
rm -f programs/goodcall-router/src/lib.rs.bak Anchor.toml.bak

echo "==> Testing"
cargo test --quiet
echo "==> Building for SBF"
# Current clusters (tested on Agave 4.3) reject SBF v0-v2 builds with
# "sbpf_version required by the executable which are not enabled"; v3 deploys.
# If your cluster says a version isn't enabled, set SBF_ARCH to one it accepts.
cargo build-sbf --arch "${SBF_ARCH:-v3}" --manifest-path programs/goodcall-router/Cargo.toml --sbf-out-dir target/deploy

DEPLOYER=$(solana address)
echo "==> Deploying $ID to $CLUSTER"
echo "    deployer / upgrade authority: $DEPLOYER ($(solana balance --url "$URL"))"
echo "    program size: $(wc -c < target/deploy/goodcall_router.so) bytes"
read -r -p "Continue? [y/N] " ok
[[ "$ok" == "y" || "$ok" == "Y" ]] || exit 1
solana program deploy --url "$URL" --program-id "$KEY" target/deploy/goodcall_router.so

echo
echo "Deployed. Put this in server/.env, then run: npm run router -- init && npm run router -- fund 0.5"
echo "ROUTER_PROGRAM_ID=$ID"
