# Vibes

Small web experiments and useful browser applications, mostly written with LLMs.

**Site:** https://vibes.atenni.com

Each experiment lives in its own folder. Everything is served as static files by GitHub Pages; there is no build step.

## Tools

- [CIDR helper](https://vibes.atenni.com/cidr/) — IPv4 and IPv6 subnet calculations, address ranges, binary masks, adjacent networks and subnet splitting. Calculations run entirely in your browser with exact `BigInt` arithmetic.

### CIDR helper

- Detects IPv4 (`/0`–`/32`) or IPv6 (`/0`–`/128`) from the input.
- Accepts full and compressed IPv6 addresses, including IPv4-embedded forms such as `::ffff:192.0.2.1/120`. Output uses lowercase compressed notation; IPv4-mapped addresses retain their dotted IPv4 tail.
- Shows IPv4 usable-host counts, including RFC 3021 point-to-point `/31` networks. Reserved ranges and platform-specific reservations are not deducted.
- Shows the full IPv6 address range, expanded input address and exact address count. IPv6 has no broadcast address; the tool does not claim that every address is assignable.
- Splits either address family into up to 256 equal subnets; select a child to inspect it.
- Supports shareable `?cidr=` URLs and copying subnet details.

Input must include a prefix, for example `192.168.1.42/24` or `2001:db8::42/64`. IPv6 zone IDs (`%en0`) and bracketed addresses (`[::1]`) are not supported.

## Local development

Serve the repository root over HTTP (JavaScript modules do not work via `file://`):

```sh
uv run python -m http.server 8000
```

Open http://localhost:8000.

Run the CIDR calculation tests with Node.js (no dependencies):

```sh
node --test cidr/ip.test.mjs
```
