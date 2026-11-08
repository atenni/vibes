import {
  addressBits,
  calculateSubnet,
  expandedAddress,
  formatAddress,
  splitSubnet,
} from "./ip.mjs";

/** @template {HTMLElement} T @param {string} id @returns {T} */
function element(id) {
  return /** @type {T} */ (document.getElementById(id));
}

const input = /** @type {HTMLInputElement} */ (element("cidr"));
const splitSelect = /** @type {HTMLSelectElement} */ (element("split-prefix"));
const number = new Intl.NumberFormat("en-AU");
/** @type {ReturnType<typeof calculateSubnet> | null} */
let subnet = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let confirmationTimeout;
/** @type {Animation | undefined} */
let resultHighlight;
/** @type {WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>} */
const copyTimeouts = new WeakMap();

/** @param {string} id @param {string | number} value */
function setText(id, value) {
  const target = element(id);
  target.textContent = String(value);
  if (target.hasAttribute("data-copy-value")) {
    target.setAttribute(
      "aria-label",
      `Copy ${target.dataset.copyLabel}: ${value}`,
    );
    target.title = `Click to copy ${target.dataset.copyLabel}`;
    target.classList.remove("copied", "copy-failed");
  }
}

function resetConfirmation() {
  clearTimeout(confirmationTimeout);
  setText("calculate-label", "Calculate");
  setText("calculate-icon", "↗");
}

function confirmCalculation() {
  resetConfirmation();
  setText("calculate-label", "Calculated");
  setText("calculate-icon", "✓");
  confirmationTimeout = setTimeout(resetConfirmation, 1500);
}

function flashResult() {
  const area = element("result-overview");
  resultHighlight?.cancel();
  const accent = getComputedStyle(area).getPropertyValue("--accent").trim();
  const frames = matchMedia("(prefers-reduced-motion: reduce)").matches
    ? [{ outlineColor: accent }, { outlineColor: accent }]
    : [
        { outlineColor: "transparent", offset: 0 },
        { outlineColor: accent, offset: 0.2 },
        { outlineColor: accent, offset: 0.7 },
        { outlineColor: "transparent", offset: 1 },
      ];
  // One gentle pulse; replacing it prevents rapid clicks from stacking effects.
  resultHighlight = area.animate(frames, {
    duration: 1200,
    easing: "ease-in-out",
  });
}

/** @param {string} id @param {bigint} address @param {number} prefix @param {import('./ip.mjs').IPVersion} version */
function renderBits(id, address, prefix, version) {
  const container = element(id);
  container.replaceChildren();
  container.setAttribute("role", "img");
  const bits = addressBits(address, version);
  const groupSize = version === 4 ? 8 : 16;
  container.setAttribute(
    "aria-label",
    `${formatAddress(address, version)} in binary: ${bits.match(/.{8}/g).join(" ")}`,
  );
  for (let start = 0; start < bits.length; start += groupSize) {
    const group = document.createElement("span");
    group.className = "bit-group";
    group.setAttribute("aria-hidden", "true");
    for (let bit = start; bit < start + groupSize; bit += 1) {
      const span = document.createElement("span");
      span.className = bit < prefix ? "network-bit" : "host-bit";
      span.textContent = bits[bit];
      group.append(span);
    }
    container.append(group);
  }
}

function renderSplit() {
  element("subnets").replaceChildren();
  if (!subnet) return;
  if (subnet.prefix === subnet.bits) {
    setText(
      "split-note",
      `A /${subnet.bits} contains one address and cannot be split.`,
    );
    return;
  }
  const prefix = Number(splitSelect.value);
  const networks = splitSubnet(subnet.cidr, prefix);
  const size = 1n << BigInt(subnet.bits - prefix);
  setText(
    "split-note",
    `${number.format(networks.length)} equal subnets · ${number.format(size)} addresses each. Select one to inspect it.`,
  );
  for (const network of networks) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = network;
    button.addEventListener("click", () => {
      calculate(network);
      // The selected button is replaced, so give keyboard users a stable target.
      element("result-heading").focus({ preventScroll: true });
      revealResult();
    });
    item.append(button);
    element("subnets").append(item);
  }
}

// Keep the summary and key figures visible without always jumping to their top.
function resultScrollDelta() {
  const result = element("result-overview").getBoundingClientRect();
  const summary = element("result-summary").getBoundingClientRect();
  const viewport = window.visualViewport;
  const top = (viewport?.offsetTop ?? 0) + 16;
  const bottom =
    (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 16;
  if (result.top >= top && result.bottom <= bottom) return 0;
  // On very short screens, prioritise the network heading over fitting every card.
  if (result.height > bottom - top) return summary.top - top;
  if (result.top < top) return result.top - top;
  return result.bottom - bottom;
}

function revealResult() {
  if (Math.abs(resultScrollDelta()) < 2) return;
  element("result-heading").focus({ preventScroll: true });
  // Re-measure after focus releases the mobile keyboard; do not chase viewport changes.
  requestAnimationFrame(() => {
    if (!subnet || element("results").hidden) return;
    const delta = resultScrollDelta();
    if (Math.abs(delta) < 2) return;
    window.scrollBy({
      top: delta,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  });
}

/** @param {string} value @param {{ updateURL?: boolean, highlight?: boolean }} options @returns {boolean} */
function calculate(value, { updateURL = true, highlight = true } = {}) {
  resetConfirmation();
  input.value = value;
  try {
    subnet = calculateSubnet(value);
  } catch (error) {
    resultHighlight?.cancel();
    subnet = null;
    setText("error", error.message);
    element("error").hidden = false;
    input.setAttribute("aria-invalid", "true");
    element("results").hidden = true;
    setText("status", "");
    return false;
  }
  input.removeAttribute("aria-invalid");
  element("error").hidden = true;
  element("results").hidden = false;
  const {
    address,
    prefix,
    version,
    bits,
    network,
    last,
    mask,
    wildcard,
    firstHost,
    lastHost,
    size,
    usable,
  } = subnet;
  const ipv6 = version === 6;
  const format = (address) => formatAddress(address, version);
  element("results").classList.toggle("ipv6", ipv6);
  for (const field of document.querySelectorAll(".ipv4-only"))
    field.hidden = ipv6;
  for (const field of document.querySelectorAll(".ipv6-only"))
    field.hidden = !ipv6;
  setText("network-label", `IPv${version} NETWORK`);
  setText("network", subnet.cidr);
  setText(
    "normalised",
    address === network
      ? "Address is on the network boundary."
      : `${format(address)} belongs to this subnet.`,
  );
  setText("total", number.format(size));
  setText("count-note", `2^${bits - prefix} addresses`);
  setText("prefix-length", `/${prefix}`);
  setText("host-bits", bits - prefix);
  if (!ipv6) {
    setText("usable", number.format(usable));
    setText("mask", format(mask));
    setText("wildcard", format(wildcard));
    setText("first-host", format(firstHost));
    setText("last-host", format(lastHost));
    setText("usable-range", `${format(firstHost)} - ${format(lastHost)}`);
  } else {
    setText("expanded-address", expandedAddress(address, version));
  }
  setText("network-address", format(network));
  setText("last-address", format(last));
  setText("address-range", `${format(network)} - ${format(last)}`);
  setText(
    "last-label",
    ipv6 || prefix >= 31 ? "Last address" : "Broadcast address",
  );
  setText(
    "range-note",
    ipv6
      ? prefix === 128
        ? "A /128 identifies one IPv6 address. IPv6 has no broadcast address."
        : "IPv6 has no broadcast address. This is the full address range, not a usable-host count; anycast, reserved addresses and platform-specific restrictions depend on usage."
      : prefix === 32
        ? "A /32 identifies one host. There is no separate broadcast address."
        : prefix === 31
          ? "On an RFC 3021 point-to-point link, both /31 addresses are usable. There is no broadcast address."
          : "Usable count excludes the network and broadcast addresses. Reserved ranges and platform-specific reservations (such as cloud providers) are not deducted.",
  );
  for (const direction of ["previous", "next"]) {
    const button = /** @type {HTMLButtonElement} */ (element(direction));
    button.disabled = subnet[direction] === null;
    button.textContent =
      direction === "previous"
        ? `← ${subnet.previous ?? `Start of IPv${version} range`}`
        : `${subnet.next ?? `End of IPv${version} range`} →`;
    button.setAttribute(
      "aria-label",
      `${direction === "previous" ? "Previous" : "Next"} network: ${subnet[direction] ?? "none"}`,
    );
  }
  renderBits("address-bits", address, prefix, version);
  renderBits("mask-bits", mask, prefix, version);
  renderBits("network-bits", network, prefix, version);
  setText(
    "bits-note",
    `${prefix} network bits + ${bits - prefix} host bits = ${bits} bits. ${ipv6 ? "Shown in 16-bit groups. " : ""}${prefix === 0 ? `The /0 covers the entire IPv${version} address space.` : "The mask keeps the network bits and clears the host bits."}`,
  );
  splitSelect.replaceChildren();
  splitSelect.disabled = prefix === bits;
  if (prefix === bits) {
    splitSelect.add(new Option("Not available", ""));
  } else {
    for (
      let target = prefix + 1;
      target <= Math.min(bits, prefix + 8);
      target += 1
    ) {
      splitSelect.add(
        new Option(
          `/${target} (${2 ** (target - prefix)} subnets)`,
          String(target),
        ),
      );
    }
  }
  renderSplit();
  if (updateURL) {
    const url = new URL(location.href);
    url.searchParams.set("cidr", `${format(address)}/${prefix}`);
    history.replaceState(null, "", url);
  }
  setText("status", `Calculated ${subnet.cidr}.`);
  if (highlight) flashResult();
  return true;
}

/** @param {string} text @param {string} message @returns {Promise<boolean>} */
async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    setText("status", message);
    return true;
  } catch {
    setText(
      "status",
      "Could not access the clipboard. You can select and copy the text manually.",
    );
    return false;
  }
}

for (const control of document.querySelectorAll("button[data-copy-value]")) {
  const button = /** @type {HTMLButtonElement} */ (control);
  button.addEventListener("click", async () => {
    const value = button.textContent ?? "";
    const success = await copy(
      value,
      `Copied ${button.dataset.copyLabel}: ${value}`,
    );
    clearTimeout(copyTimeouts.get(button));
    button.classList.remove("copied", "copy-failed");
    button.classList.add(success ? "copied" : "copy-failed");
    copyTimeouts.set(
      button,
      setTimeout(() => button.classList.remove("copied", "copy-failed"), 1500),
    );
  });
}

element("calculator").addEventListener("submit", (event) => {
  event.preventDefault();
  if (calculate(input.value)) {
    confirmCalculation();
    revealResult();
  } else {
    input.focus({ preventScroll: true });
  }
});
input.addEventListener("input", resetConfirmation);
for (const button of document.querySelectorAll("[data-example]")) {
  button.addEventListener("click", () =>
    calculate(button.getAttribute("data-example")),
  );
}
splitSelect.addEventListener("change", renderSplit);
for (const direction of ["previous", "next"]) {
  element(direction).addEventListener("click", () => {
    if (subnet?.[direction]) calculate(subnet[direction]);
  });
}
element("share").addEventListener("click", () =>
  copy(location.href, "Link copied."),
);
element("copy-details").addEventListener("click", () => {
  if (!subnet) return;
  const {
    cidr,
    version,
    mask,
    wildcard,
    network,
    last,
    prefix,
    firstHost,
    lastHost,
    size,
    usable,
  } = subnet;
  const format = (address) => formatAddress(address, version);
  copy(
    [
      `Network: ${cidr}`,
      `IP version: IPv${version}`,
      `Address range: ${format(network)} – ${format(last)}`,
      `Total addresses: ${size}`,
      ...(version === 4
        ? [
            `Subnet mask: ${format(mask)}`,
            `Wildcard mask: ${format(wildcard)}`,
            ...(prefix < 31 ? [`Broadcast: ${format(last)}`] : []),
            `Usable range: ${format(firstHost)} – ${format(lastHost)}`,
            `Usable addresses: ${usable}${prefix === 31 ? " (RFC 3021 point-to-point)" : ""}`,
          ]
        : [
            `Expanded input address: ${expandedAddress(subnet.address, 6)}`,
            "IPv6 has no broadcast address. Address count does not imply all addresses are assignable.",
          ]),
    ].join("\n"),
    "Subnet details copied.",
  );
});
window.addEventListener("popstate", () =>
  calculate(
    new URL(location.href).searchParams.get("cidr") ?? "192.168.1.42/24",
    { updateURL: false },
  ),
);
calculate(new URL(location.href).searchParams.get("cidr") ?? input.value, {
  highlight: false,
});
