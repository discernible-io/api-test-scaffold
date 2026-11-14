# On-chain evidence index

Mainnet contract: `genaaaa-identyclaw-com.near`.

Paired **login outcomes** for ownership transfer (old FAIL + new PASS) live in [`TRANSFER-TEST-REPORT.md`](TRANSFER-TEST-REPORT.md). This page is the short explorer index only.

## Contest transfer run (2026-11-14 UTC)

| Action | Token | From → To | Explorer |
|--------|-------|-----------|----------|
| `rodit_transfer` (outbound) | `cdcqsfbrsncj` | `24c0ecfe…90c4c3c3` → `2e936b69…d53ee552` | [nearblocks](https://nearblocks.io/txns/4RYaXma5qTUk5PgvfdKJBdDuEMGrEeQquBHez8dQ5G6n) |
| `rodit_transfer` (return) | `cdcqsfbrsncj` | `2e936b69…d53ee552` → `24c0ecfe…90c4c3c3` | [nearblocks](https://nearblocks.io/txns/3Dg6cGCPs3Q8MMLGMJ5ENSBf7bnrhN8Hk4SRtzKatuRz) |

Login probes for that run used `examples/native-login.js` against `https://api.identyclaw.com` (see the transfer report for JWT `jti` / HTTP statuses). **No keys committed.**
