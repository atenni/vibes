import { addressBits, calculateSubnet, expandedAddress, formatAddress, splitSubnet } from './ip.mjs';

/** @template {HTMLElement} T @param {string} id @returns {T} */
function element(id) {
  return /** @type {T} */ (document.getElementById(id));
}

const input = /** @type {HTMLInputElement} */ (element('cidr'));
const splitSelect = /** @type {HTMLSelectElement} */ (element('split-prefix'));
const number = new Intl.NumberFormat('en-AU');
/** @type {ReturnType<typeof calculateSubnet> | null} */
let subnet = null;

/** @param {string} id @param {string | number} value */
function setText(id, value) {
  element(id).textContent = String(value);
}

/** @param {string} id @param {bigint} address @param {number} prefix @param {import('./ip.mjs').IPVersion} version */
function renderBits(id, address, prefix, version) {
  const container = element(id);
  container.replaceChildren();
  container.setAttribute('role', 'img');
  const bits = addressBits(address, version);
  const groupSize = version === 4 ? 8 : 16;
  container.setAttribute('aria-label', `${formatAddress(address, version)} in binary: ${bits.match(/.{8}/g).join(' ')}`);
  for (let start = 0; start < bits.length; start += groupSize) {
    const group = document.createElement('span');
    group.className = 'bit-group';
    group.setAttribute('aria-hidden', 'true');
    for (let bit = start; bit < start + groupSize; bit += 1) {
      const span = document.createElement('span');
      span.className = bit < prefix ? 'network-bit' : 'host-bit';
      span.textContent = bits[bit];
      group.append(span);
    }
    container.append(group);
  }
}

function renderSplit() {
  element('subnets').replaceChildren();
  if (!subnet) return;
  if (subnet.prefix === subnet.bits) {
    setText('split-note', `A /${subnet.bits} contains one address and cannot be split.`);
    return;
  }
  const prefix = Number(splitSelect.value);
  const networks = splitSubnet(subnet.cidr, prefix);
  const size = 1n << BigInt(subnet.bits - prefix);
  setText('split-note', `${number.format(networks.length)} equal subnets · ${number.format(size)} addresses each. Select one to inspect it.`);
  for (const network of networks) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = network;
    button.addEventListener('click', () => {
      calculate(network);
      input.focus();
      element('calculator').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    item.append(button);
    element('subnets').append(item);
  }
}

/** @param {string} value @param {boolean} updateURL */
function calculate(value, updateURL = true) {
  input.value = value;
  try {
    subnet = calculateSubnet(value);
  } catch (error) {
    subnet = null;
    setText('error', error.message);
    element('error').hidden = false;
    input.setAttribute('aria-invalid', 'true');
    element('results').hidden = true;
    setText('status', '');
    return;
  }
  input.removeAttribute('aria-invalid');
  element('error').hidden = true;
  element('results').hidden = false;
  const { address, prefix, version, bits, network, last, mask, wildcard, firstHost, lastHost, size, usable } = subnet;
  const ipv6 = version === 6;
  const format = (address) => formatAddress(address, version);
  element('results').classList.toggle('ipv6', ipv6);
  for (const field of document.querySelectorAll('.ipv4-only')) field.hidden = ipv6;
  for (const field of document.querySelectorAll('.ipv6-only')) field.hidden = !ipv6;
  setText('network-label', `IPv${version} NETWORK`);
  setText('network', subnet.cidr);
  setText('normalised', address === network ? 'Address is on the network boundary.' : `${format(address)} belongs to this subnet.`);
  setText('total', number.format(size));
  setText('count-note', `2^${bits - prefix} addresses`);
  setText('prefix-length', `/${prefix}`);
  setText('host-bits', bits - prefix);
  if (!ipv6) {
    setText('usable', number.format(usable));
    setText('mask', format(mask));
    setText('wildcard', format(wildcard));
    setText('first-host', format(firstHost));
    setText('last-host', format(lastHost));
  } else {
    setText('expanded-address', expandedAddress(address, version));
  }
  setText('network-address', format(network));
  setText('last-address', format(last));
  setText('last-label', ipv6 || prefix >= 31 ? 'Last address' : 'Broadcast address');
  setText('range-note', ipv6
    ? prefix === 128
      ? 'A /128 identifies one IPv6 address. IPv6 has no broadcast address.'
      : 'IPv6 has no broadcast address. This is the full address range, not a usable-host count; anycast, reserved addresses and platform-specific restrictions depend on usage.'
    : prefix === 32
      ? 'A /32 identifies one host. There is no separate broadcast address.'
      : prefix === 31
        ? 'On an RFC 3021 point-to-point link, both /31 addresses are usable. There is no broadcast address.'
        : 'Usable count excludes the network and broadcast addresses. Reserved ranges and platform-specific reservations (such as cloud providers) are not deducted.');
  for (const direction of ['previous', 'next']) {
    const button = /** @type {HTMLButtonElement} */ (element(direction));
    button.disabled = subnet[direction] === null;
    button.textContent = direction === 'previous'
      ? `← ${subnet.previous ?? `Start of IPv${version} range`}`
      : `${subnet.next ?? `End of IPv${version} range`} →`;
    button.setAttribute('aria-label', `${direction === 'previous' ? 'Previous' : 'Next'} network: ${subnet[direction] ?? 'none'}`);
  }
  renderBits('address-bits', address, prefix, version);
  renderBits('mask-bits', mask, prefix, version);
  renderBits('network-bits', network, prefix, version);
  setText('bits-note', `${prefix} network bits + ${bits - prefix} host bits = ${bits} bits. ${ipv6 ? 'Shown in 16-bit groups. ' : ''}${prefix === 0 ? `The /0 covers the entire IPv${version} address space.` : 'The mask keeps the network bits and clears the host bits.'}`);
  splitSelect.replaceChildren();
  splitSelect.disabled = prefix === bits;
  if (prefix === bits) {
    splitSelect.add(new Option('Not available', ''));
  } else {
    for (let target = prefix + 1; target <= Math.min(bits, prefix + 8); target += 1) {
      splitSelect.add(new Option(`/${target} (${2 ** (target - prefix)} subnets)`, String(target)));
    }
  }
  renderSplit();
  if (updateURL) {
    const url = new URL(location.href);
    url.searchParams.set('cidr', `${format(address)}/${prefix}`);
    history.replaceState(null, '', url);
  }
  setText('status', `Calculated ${subnet.cidr}.`);
}

/** @param {string} text @param {string} message */
async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    setText('status', message);
  } catch {
    setText('status', 'Could not access the clipboard. You can select and copy the text manually.');
  }
}

element('calculator').addEventListener('submit', (event) => {
  event.preventDefault();
  calculate(input.value);
});
for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', () => calculate(button.getAttribute('data-example')));
}
splitSelect.addEventListener('change', renderSplit);
for (const direction of ['previous', 'next']) {
  element(direction).addEventListener('click', () => {
    if (subnet?.[direction]) calculate(subnet[direction]);
  });
}
element('share').addEventListener('click', () => copy(location.href, 'Link copied.'));
element('copy-details').addEventListener('click', () => {
  if (!subnet) return;
  const { cidr, version, mask, wildcard, network, last, prefix, firstHost, lastHost, size, usable } = subnet;
  const format = (address) => formatAddress(address, version);
  copy([
    `Network: ${cidr}`,
    `IP version: IPv${version}`,
    `Address range: ${format(network)} – ${format(last)}`,
    `Total addresses: ${size}`,
    ...(version === 4 ? [
      `Subnet mask: ${format(mask)}`,
      `Wildcard mask: ${format(wildcard)}`,
      ...(prefix < 31 ? [`Broadcast: ${format(last)}`] : []),
      `Usable range: ${format(firstHost)} – ${format(lastHost)}`,
      `Usable addresses: ${usable}${prefix === 31 ? ' (RFC 3021 point-to-point)' : ''}`,
    ] : [
      `Expanded input address: ${expandedAddress(subnet.address, 6)}`,
      'IPv6 has no broadcast address. Address count does not imply all addresses are assignable.',
    ]),
  ].join('\n'), 'Subnet details copied.');
});
window.addEventListener('popstate', () => calculate(new URL(location.href).searchParams.get('cidr') ?? '192.168.1.42/24', false));
calculate(new URL(location.href).searchParams.get('cidr') ?? input.value);
