# CIDR helper

A browser-only IPv4 and IPv6 subnet calculator with exact `BigInt` arithmetic. No dependencies or build step.

**Open:** https://vibes.atenni.com/cidr/

## Features

- Detects IPv4 (`/0`–`/32`) or IPv6 (`/0`–`/128`) from the input.
- Calculates network boundaries, address ranges and subnet sizes.
- Displays binary network/host bits and navigates adjacent networks.
- Accepts full and compressed IPv6 addresses, including IPv4-embedded forms such as `::ffff:192.0.2.1/120`. Output uses lowercase compressed notation; IPv4-mapped addresses retain their dotted IPv4 tail.
- Shows IPv4 subnet and wildcard masks, usable-host counts and usable ranges, including RFC 3021 point-to-point `/31` networks. Reserved ranges and platform-specific reservations are not deducted.
- Shows the full IPv6 address range, expanded input address and exact address count. IPv6 has no broadcast address; the tool does not claim that every address is assignable.
- Splits either address family into up to 256 equal subnets; select a child to inspect it.
- Supports shareable `?cidr=` URLs and copying subnet details.
- Click an underlined CIDR, address, mask or range to copy its value. Ranges are copied as `start - end`, with no labels or extra formatting. Copy controls also work with the keyboard and show local success/failure feedback.
- Groups the summary and key figures in a labelled result area. Successful Calculate/Enter submissions briefly confirm success and emphasise that area, scrolling only when it is not already visible.

All calculations run locally in your browser.

## Input

Input must include a prefix, for example `192.168.1.42/24` or `2001:db8::42/64`. Any address in the subnet works; the calculator finds the network boundary.

IPv6 zone IDs (`%en0`) and bracketed addresses (`[::1]`) are not supported.

## Local development

Follow the [repository server instructions](../README.md#local-development), then open http://localhost:8000/cidr/. JavaScript modules require HTTP rather than `file://`.

Run the calculation tests with Node.js from the repository root (no dependencies):

```sh
node --test cidr/ip.test.mjs
```
