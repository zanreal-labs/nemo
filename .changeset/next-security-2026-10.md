---
"@zanreal/nemo": patch
---

Bump the `next` dev dependency to 16.4.2, the October 2026 Next.js security release
(GHSA-673q-mjm6-r5xr, CVE-2026-96889, CVE-2026-94545). The `next` peer range stays
`>=13.0.0`, so nothing changes for existing installs and 16.4.x is accepted. Consumers should
upgrade their own `next` to 16.4.1 or newer, and `react`/`react-dom` to 19.2.9 or 19.3.1
(GHSA-xqc2-xf4c-x3h3).
