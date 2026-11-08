/** @typedef {4 | 6} IPVersion */

/** @param {IPVersion} version @returns {number} */
export function addressWidth(version) {
  if (version !== 4 && version !== 6) throw new Error('IP version must be 4 or 6.');
  return version === 4 ? 32 : 128;
}

/** @param {string} value @returns {bigint} */
function parseIPv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    throw new Error('Enter an IPv4 address with four octets between 0 and 255.');
  }
  return parts.reduce((address, part) => (address << 8n) | BigInt(part), 0n);
}

/** @param {string} value @returns {bigint} */
function parseIPv6(value) {
  // IPv4-embedded addresses use their final two 16-bit groups for dotted IPv4.
  if (value.includes('.')) {
    const colon = value.lastIndexOf(':');
    const tail = parseIPv4(value.slice(colon + 1));
    value = `${value.slice(0, colon + 1)}${(tail >> 16n).toString(16)}:${(tail & 0xffffn).toString(16)}`;
  }
  const halves = value.split('::');
  const invalid = () => new Error('Enter a valid IPv6 address, for example 2001:db8::1. Zone IDs and brackets are not supported.');
  if (halves.length > 2) throw invalid();
  const left = halves[0] === '' ? [] : halves[0].split(':');
  const right = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
  const explicit = left.length + right.length;
  if ([...left, ...right].some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) throw invalid();
  if (halves.length === 1 ? explicit !== 8 : explicit >= 8) throw invalid();
  const groups = halves.length === 1 ? left : [...left, ...Array(8 - explicit).fill('0'), ...right];
  return groups.reduce((address, group) => (address << 16n) | BigInt(`0x${group}`), 0n);
}

/** @param {string} value @param {IPVersion} version @returns {bigint} */
export function parseAddress(value, version = value.includes(':') ? 6 : 4) {
  addressWidth(version);
  return version === 4 ? parseIPv4(value) : parseIPv6(value);
}

/** @param {bigint} address @param {IPVersion} version */
function validateAddress(address, version) {
  const bits = addressWidth(version);
  if (typeof address !== 'bigint' || address < 0n || address >= (1n << BigInt(bits))) {
    throw new Error(`Address is outside the IPv${version} range.`);
  }
}

/** @param {bigint} address @param {IPVersion} version @returns {string} */
export function expandedAddress(address, version = 6) {
  validateAddress(address, version);
  if (version === 4) return [24n, 16n, 8n, 0n].map((shift) => String((address >> shift) & 255n)).join('.');
  return address.toString(16).padStart(32, '0').match(/.{4}/g).join(':');
}

/** @param {bigint} address @param {IPVersion} version @returns {string} */
export function formatAddress(address, version = 4) {
  validateAddress(address, version);
  if (version === 4) return expandedAddress(address, 4);
  // RFC 5952: lowercase, no leading zeroes, longest zero run (first on ties).
  // Keep IPv4-mapped addresses recognisable in their standard mixed notation.
  if ((address >> 32n) === 0xffffn) return `::ffff:${formatAddress(address & 0xffffffffn, 4)}`;
  const groups = expandedAddress(address, 6).split(':').map((group) => Number.parseInt(group, 16).toString(16));
  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < groups.length;) {
    if (groups[start] !== '0') {
      start += 1;
      continue;
    }
    let end = start;
    while (end < groups.length && groups[end] === '0') end += 1;
    if (end - start > bestLength) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  if (bestStart === -1) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLength).join(':')}`;
}

/** @param {string} value @returns {{ address: bigint, prefix: number, version: IPVersion, bits: number }} */
export function parseCIDR(value) {
  const parts = value.trim().split('/');
  if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) {
    throw new Error('Enter an IP address and prefix, for example 192.168.1.42/24 or 2001:db8::1/64.');
  }
  const version = parts[0].includes(':') ? 6 : 4;
  const bits = addressWidth(version);
  const prefix = Number(parts[1]);
  if (prefix > bits) throw new Error(`IPv${version} prefixes must be between 0 and ${bits}.`);
  return { address: parseAddress(parts[0], version), prefix, version, bits };
}

/** @param {string} value */
export function calculateSubnet(value) {
  const { address, prefix, version, bits } = parseCIDR(value);
  const max = (1n << BigInt(bits)) - 1n;
  const size = 1n << BigInt(bits - prefix);
  const mask = max ^ (size - 1n);
  const network = address & mask;
  const last = network + size - 1n;
  const ipv4 = version === 4;
  // IPv6 has no broadcast address and no universal usable-host count.
  // IPv4 /31 permits both addresses on RFC 3021 point-to-point links.
  return {
    address, prefix, version, bits, size, network, last, mask,
    wildcard: size - 1n,
    firstHost: ipv4 ? (prefix >= 31 ? network : network + 1n) : null,
    lastHost: ipv4 ? (prefix >= 31 ? last : last - 1n) : null,
    usable: ipv4 ? (prefix >= 31 ? size : size - 2n) : null,
    cidr: `${formatAddress(network, version)}/${prefix}`,
    previous: network === 0n ? null : `${formatAddress(network - size, version)}/${prefix}`,
    next: last === max ? null : `${formatAddress(last + 1n, version)}/${prefix}`,
  };
}

/** @param {string} value @param {number} newPrefix @returns {string[]} */
export function splitSubnet(value, newPrefix) {
  const subnet = calculateSubnet(value);
  if (!Number.isInteger(newPrefix) || newPrefix <= subnet.prefix || newPrefix > subnet.bits) {
    throw new Error(`The split prefix must be longer than the original prefix and at most ${subnet.bits}.`);
  }
  const count = 2 ** (newPrefix - subnet.prefix);
  if (count > 256) throw new Error('Choose a prefix that produces no more than 256 subnets.');
  const size = 1n << BigInt(subnet.bits - newPrefix);
  return Array.from({ length: count }, (_, index) => `${formatAddress(subnet.network + BigInt(index) * size, subnet.version)}/${newPrefix}`);
}

/** @param {bigint} address @param {IPVersion} version @returns {string} */
export function addressBits(address, version = 4) {
  validateAddress(address, version);
  return address.toString(2).padStart(addressWidth(version), '0');
}
