import test from 'node:test';
import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { addressBits, addressWidth, calculateSubnet, expandedAddress, formatAddress, parseAddress, parseCIDR, splitSubnet } from './ip.mjs';

test('normalises an IPv4 host address and calculates a /24', () => {
  assert.deepEqual(calculateSubnet('192.168.1.42/24'), {
    address: parseAddress('192.168.1.42'), prefix: 24, version: 4, bits: 32, size: 256n,
    network: parseAddress('192.168.1.0'), last: parseAddress('192.168.1.255'),
    mask: parseAddress('255.255.255.0'), wildcard: 255n,
    firstHost: parseAddress('192.168.1.1'), lastHost: parseAddress('192.168.1.254'), usable: 254n,
    cidr: '192.168.1.0/24', previous: '192.168.0.0/24', next: '192.168.2.0/24',
  });
});

test('IPv4 /0 handles the entire address space exactly', () => {
  const result = calculateSubnet('203.0.113.1/0');
  assert.equal(result.cidr, '0.0.0.0/0');
  assert.equal(result.size, 4294967296n);
  assert.equal(result.usable, 4294967294n);
  assert.equal(formatAddress(result.last), '255.255.255.255');
  assert.equal(result.mask, 0n);
  assert.equal(result.wildcard, 0xffffffffn);
  assert.equal(result.previous, null);
  assert.equal(result.next, null);
});

test('IPv4 /31 uses point-to-point semantics; /32 is a single host', () => {
  const pair = calculateSubnet('192.0.2.1/31');
  assert.equal(pair.cidr, '192.0.2.0/31');
  assert.equal(pair.usable, 2n);
  assert.equal(pair.firstHost, pair.network);
  assert.equal(pair.lastHost, pair.last);
  const host = calculateSubnet('255.255.255.255/32');
  assert.equal(host.usable, 1n);
  assert.equal(host.firstHost, host.lastHost);
  assert.equal(host.previous, '255.255.255.254/32');
  assert.equal(host.next, null);
});

test('adjacent IPv4 networks do not wrap around address-space boundaries', () => {
  assert.equal(calculateSubnet('0.0.0.0/1').previous, null);
  assert.equal(calculateSubnet('0.0.0.0/1').next, '128.0.0.0/1');
  assert.equal(calculateSubnet('128.0.0.0/1').previous, '0.0.0.0/1');
  assert.equal(calculateSubnet('128.0.0.0/1').next, null);
});

test('splits IPv4 from the normalised boundary and limits output to 256', () => {
  assert.deepEqual(splitSubnet('10.0.0.42/24', 26), [
    '10.0.0.0/26', '10.0.0.64/26', '10.0.0.128/26', '10.0.0.192/26',
  ]);
  assert.equal(splitSubnet('0.0.0.0/0', 8).length, 256);
  assert.deepEqual(splitSubnet('255.255.255.254/31', 32), ['255.255.255.254/32', '255.255.255.255/32']);
  for (const prefix of [24, 23, 33, 25.5, NaN]) assert.throws(() => splitSubnet('10.0.0.0/24', prefix));
  assert.throws(() => splitSubnet('0.0.0.0/0', 9));
});

test('rejects malformed IPv4 addresses and CIDR prefixes', () => {
  for (const value of ['', '192.168.1.1', '192.168.1.1/', '1.2.3.4/33', '1.2.3.4/-1', '1.2.3.4/2.5', '256.1.1.1/24', '1.2.3/24', '1..2.3/24', '1.2.3.4/24/1', '1.2.3.4/0x10', '<script>/24', '1e2.0.0.1/24', '1.2.3.4/+24', '1.2.3.4/Infinity']) {
    assert.throws(() => parseCIDR(value), value);
  }
  // Preserve decimal leading-zero input accepted by the original IPv4 helper.
  assert.deepEqual(parseCIDR(' 192.168.001.042/24 '), { address: parseAddress('192.168.1.42'), prefix: 24, version: 4, bits: 32 });
});

test('parses IPv6 full, compressed, uppercase and IPv4-embedded forms', () => {
  const equivalent = [
    '2001:db8::1', '2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8:0:0:0:0:0:1',
  ];
  for (const address of equivalent) {
    assert.equal(parseAddress(address), 0x20010db8000000000000000000000001n);
    assert.equal(isIP(address), 6);
  }
  assert.equal(parseAddress('::'), 0n);
  assert.equal(parseAddress('::1'), 1n);
  assert.equal(parseAddress('1::'), 1n << 112n);
  assert.equal(parseAddress('::ffff:192.0.2.128'), parseAddress('::ffff:c000:280'));
  assert.equal(parseAddress('2001:db8::192.0.2.1'), parseAddress('2001:db8::c000:201'));
  assert.equal(parseAddress('1:2:3:4:5:6:192.0.2.1'), parseAddress('1:2:3:4:5:6:c000:201'));
  assert.deepEqual(parseCIDR(' 2001:db8::1/64 '), { address: parseAddress('2001:db8::1'), prefix: 64, version: 6, bits: 128 });
});

test('canonical IPv6 formatting follows RFC 5952 compression rules', () => {
  const cases = [
    ['0:0:0:0:0:0:0:0', '::'],
    ['0:0:0:0:0:0:0:1', '::1'],
    ['2001:0DB8:0000:0000:0000:FF00:0042:8329', '2001:db8::ff00:42:8329'],
    ['1:0:0:2:0:0:3:4', '1::2:0:0:3:4'], // First longest run on ties.
    ['1:0:0:2:0:0:0:4', '1:0:0:2::4'],
    ['1:2:3:4:5:6:0:8', '1:2:3:4:5:6:0:8'], // Do not compress a lone zero.
    ['1:2:3:4:0:0:0:0', '1:2:3:4::'],
    ['0:0:0:0:1:2:3:4', '::1:2:3:4'],
    ['::ffff:c000:201', '::ffff:192.0.2.1'],
    ['2001:db8::192.0.2.1', '2001:db8::c000:201'],
  ];
  for (const [input, expected] of cases) {
    const formatted = formatAddress(parseAddress(input), 6);
    assert.equal(formatted, expected);
    assert.equal(isIP(formatted), 6);
    assert.equal(parseAddress(formatted), parseAddress(input));
  }
  assert.equal(expandedAddress(parseAddress('2001:db8::1')), '2001:0db8:0000:0000:0000:0000:0000:0001');
});

test('rejects invalid IPv6 compression, groups, embedded addresses and unsupported zone IDs', () => {
  for (const address of [
    ':', ':::1', '1:::2', '1::2::3', ':1:2:3:4:5:6:7', '1:2:3:4:5:6:7:',
    '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8::', '1:2:3:4:5:6:7::8',
    '12345::', 'gggg::', '-1::', '0x1::', '2001:db8:: 1', '[::1]', 'fe80::1%en0', 'fe80::1%3',
    '::ffff:256.0.0.1', '::ffff:192.0.2', '::192.0.2.1:1', '1:2:3:4:5:192.0.2.1', '1:2:3:4:5:6::192.0.2.1',
  ]) {
    assert.throws(() => parseAddress(address, 6), address);
  }
  for (const value of ['::1', '::1/129', '::1/-1', '::1/64.5', '::1/64/1', '::1/ 64', '::1/+64', '::1/0x40']) {
    assert.throws(() => parseCIDR(value), value);
  }
});

test('IPv6 /64 uses exact counts and does not invent usable-host semantics', () => {
  const subnet = calculateSubnet('2001:db8:1234:5678::42/64');
  assert.equal(subnet.version, 6);
  assert.equal(subnet.bits, 128);
  assert.equal(subnet.cidr, '2001:db8:1234:5678::/64');
  assert.equal(subnet.size, 18446744073709551616n);
  assert.equal(formatAddress(subnet.last, 6), '2001:db8:1234:5678:ffff:ffff:ffff:ffff');
  assert.equal(subnet.usable, null);
  assert.equal(subnet.firstHost, null);
  assert.equal(subnet.lastHost, null);
  assert.equal(subnet.previous, '2001:db8:1234:5677::/64');
  assert.equal(subnet.next, '2001:db8:1234:5679::/64');
});

test('IPv6 /0, /127 and /128 handle exact counts and address boundaries', () => {
  const entire = calculateSubnet('2001:db8::1/0');
  assert.equal(entire.cidr, '::/0');
  assert.equal(entire.size, 340282366920938463463374607431768211456n);
  assert.equal(formatAddress(entire.last, 6), 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
  assert.equal(entire.previous, null);
  assert.equal(entire.next, null);
  const pair = calculateSubnet('2001:db8::3/127');
  assert.equal(pair.cidr, '2001:db8::2/127');
  assert.equal(pair.size, 2n);
  assert.equal(pair.last, parseAddress('2001:db8::3'));
  const host = calculateSubnet('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128');
  assert.equal(host.size, 1n);
  assert.equal(host.network, host.last);
  assert.equal(host.next, null);
  assert.equal(host.previous, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe/128');
  assert.equal(calculateSubnet('::/128').previous, null);
  assert.equal(calculateSubnet('::/128').next, '::1/128');
  assert.equal(calculateSubnet('::/1').next, '8000::/1');
  assert.equal(calculateSubnet('8000::/1').previous, '::/1');
  assert.equal(calculateSubnet('8000::/1').next, null);
});

test('splits IPv6 across 16-bit boundaries and limits output before allocation', () => {
  assert.deepEqual(splitSubnet('2001:db8:abcd:12ff::1/56', 58), [
    '2001:db8:abcd:1200::/58', '2001:db8:abcd:1240::/58',
    '2001:db8:abcd:1280::/58', '2001:db8:abcd:12c0::/58',
  ]);
  const networks = splitSubnet('2001:db8:abcd:1200::/56', 64);
  assert.equal(networks.length, 256);
  assert.equal(networks[0], '2001:db8:abcd:1200::/64');
  assert.equal(networks.at(-1), '2001:db8:abcd:12ff::/64');
  assert.deepEqual(splitSubnet('2001:db8::/127', 128), ['2001:db8::/128', '2001:db8::1/128']);
  for (const prefix of [55, 56, 65, 129, 57.5, NaN]) assert.throws(() => splitSubnet('2001:db8::/56', prefix));
  assert.throws(() => splitSubnet('::/0', 128));
  assert.throws(() => splitSubnet('::/128', 129));
});

test('binary output preserves leading zeroes for both address widths', () => {
  assert.equal(addressBits(0n), '0'.repeat(32));
  assert.equal(addressBits(0xffffffffn), '1'.repeat(32));
  assert.equal(addressBits(parseAddress('192.168.1.42')), '11000000101010000000000100101010');
  assert.equal(addressBits(0n, 6), '0'.repeat(128));
  assert.equal(addressBits(parseAddress('::1'), 6), '0'.repeat(127) + '1');
  assert.equal(addressBits((1n << 128n) - 1n, 6), '1'.repeat(128));
});

test('rejects out-of-range values and unsupported address versions', () => {
  for (const version of [4, 6]) {
    for (const address of [-1n, 1n << BigInt(addressWidth(version)), 1.5, NaN, 0]) {
      assert.throws(() => formatAddress(address, version));
      assert.throws(() => addressBits(address, version));
    }
  }
  assert.throws(() => addressWidth(5));
  assert.throws(() => parseAddress('1.2.3.4', 5));
});

for (const version of [4, 6]) {
  test(`every IPv${version} prefix maintains range, mask and alignment invariants`, () => {
    const bits = addressWidth(version);
    const max = (1n << BigInt(bits)) - 1n;
    const samples = [0n, 1n, max >> 1n, (max >> 1n) + 1n, max - 1n, max,
      version === 4 ? parseAddress('192.168.1.42') : parseAddress('2001:db8:abcd:1234:5678:90ab:cdef:1234')];
    for (let prefix = 0; prefix <= bits; prefix += 1) {
      for (const address of samples) {
        const subnet = calculateSubnet(`${formatAddress(address, version)}/${prefix}`);
        assert.ok(subnet.network <= address && address <= subnet.last);
        assert.equal(subnet.network % subnet.size, 0n);
        assert.equal(subnet.last - subnet.network + 1n, subnet.size);
        assert.equal(subnet.mask + subnet.wildcard, max);
        assert.equal(address & subnet.mask, subnet.network);
        assert.equal(parseAddress(formatAddress(address, version)), address);
        if (subnet.next) assert.equal(calculateSubnet(subnet.next).network, subnet.last + 1n);
        if (subnet.previous) assert.equal(calculateSubnet(subnet.previous).last, subnet.network - 1n);
      }
    }
  });
}

test('deterministic IPv6 samples round-trip through compressed, expanded and binary formats', () => {
  const max = (1n << 128n) - 1n;
  let address = 0x20010db8000000000000000000000001n;
  for (let index = 0; index < 1000; index += 1) {
    address = (address * 6364136223846793005n + 1442695040888963407n) & max;
    const compressed = formatAddress(address, 6);
    assert.equal(isIP(compressed), 6);
    assert.equal(parseAddress(compressed), address);
    assert.equal(parseAddress(expandedAddress(address)), address);
    assert.equal(BigInt('0b' + addressBits(address, 6)), address);
  }
});
