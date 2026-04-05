# Dytallix Faucet

Public testnet faucet for Dytallix.

It funds a D-Addr with testnet `DGT` and `DRT` so developers can move from
first keypair to first transaction without waiting on manual allocation.

## Live Service

- Canonical base URL: `https://dytallix.com/api/faucet`
- Status endpoint: `https://dytallix.com/api/faucet/status`
- Verified against the live service on April 5, 2026

There is no separate public `faucet.dytallix.com` host. The supported public
endpoint lives under `dytallix.com/api/faucet`.

## Current Testnet Limits

The live faucet currently reports:

- `10 DGT` per request
- `100 DRT` per request
- `60` minute cooldown window
- `3` requests per hour

These values come from `GET /status` and may change as the network evolves.

## Fast Path

### 1. Generate a D-Addr

If you need a fresh D-Addr first:

```bash
cargo add dytallix-sdk
```

```rust
use dytallix_sdk::{DAddr, DytallixKeypair};

fn main() {
    let keypair = DytallixKeypair::generate();
    let addr = DAddr::from_public_key(keypair.public_key()).unwrap();
    println!("{addr}");
}
```

The SDK quickstart lives here:

- SDK: https://github.com/DytallixHQ/dytallix-sdk

### 2. Request Faucet Funds With `curl`

```bash
curl -X POST https://dytallix.com/api/faucet/request \
  -H 'content-type: application/json' \
  -d '{
    "address": "<D-ADDR>",
    "dgt_amount": 10,
    "drt_amount": 100
  }'
```

Example live response:

```json
{
  "success": true,
  "funded": {
    "dgt": 10,
    "drt": 100
  },
  "message": "Tokens sent successfully"
}
```

### 3. Request Faucet Funds With the CLI

```bash
cargo install --git https://github.com/DytallixHQ/dytallix-sdk.git dytallix-cli --bin dytallix
dytallix faucet <D-ADDR>
```

If you already initialized a local keystore, you can fund the active address:

```bash
dytallix faucet
```

## API

### `GET /status`

Returns live faucet availability and current request limits.

```bash
curl https://dytallix.com/api/faucet/status
```

Live response observed on April 5, 2026:

```json
{
  "status": "operational",
  "limits": {
    "dgt": 10,
    "drt": 100,
    "cooldownMinutes": 60,
    "maxRequestsPerHour": 3
  },
  "activeUsers": 24
}
```

### `GET /check/:address`

Checks whether an address is currently allowed to request funds.

```bash
curl https://dytallix.com/api/faucet/check/<D-ADDR>
```

Live response observed on April 5, 2026:

```json
{
  "address": "dytallix15krmltc0pq929v3upr9qtaf9eevk22fhf8gspggp7gjlwdcyuhvq4909fd",
  "allowed": true
}
```

### `POST /request`

Requests testnet `DGT` and `DRT` for a D-Addr.

```bash
curl -X POST https://dytallix.com/api/faucet/request \
  -H 'content-type: application/json' \
  -d '{
    "address": "<D-ADDR>",
    "dgt_amount": 10,
    "drt_amount": 100
  }'
```

Request body:

```json
{
  "address": "<D-ADDR>",
  "dgt_amount": 10,
  "drt_amount": 100
}
```

Success response:

```json
{
  "success": true,
  "funded": {
    "dgt": 10,
    "drt": 100
  },
  "message": "Tokens sent successfully"
}
```

If the faucet is rate-limited or temporarily unavailable, the request returns a
non-success HTTP status and should be retried later.

## SDK Integration

For a Rust client that talks to the canonical faucet endpoint:

```bash
cargo add dytallix-sdk --features network
cargo add tokio --features macros,rt-multi-thread
```

```rust
use dytallix_sdk::{DAddr, DytallixKeypair};
use dytallix_sdk::faucet::FaucetClient;

#[tokio::main]
async fn main() {
    let keypair = DytallixKeypair::generate();
    let addr = DAddr::from_public_key(keypair.public_key()).unwrap();

    let faucet = FaucetClient::testnet();
    let balance = faucet.fund(&addr).await.unwrap();

    println!("address: {addr}");
    println!("funded: {} DGT / {} DRT", balance.dgt, balance.drt);
}
```

## Related Repositories

- SDK: https://github.com/DytallixHQ/dytallix-sdk
- Node: https://github.com/DytallixHQ/dytallix-node
- Explorer: https://github.com/DytallixHQ/dytallix-explorer
- Docs: https://github.com/DytallixHQ/dytallix-docs
- Org profile: https://github.com/DytallixHQ

## Support

- Website: https://dytallix.com
- Discord: https://discord.gg/eyVvu5kmPG
