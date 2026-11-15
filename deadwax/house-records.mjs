/* The house records stocked on a new shelf, in shelf order. Their text lives
   in examples/ so the files people download are the ones the app plays. */
export const HOUSE_RECORDS = [
  "01-bus-window.deadwax",
  "02-rewind.deadwax",
  "03-corner-store.deadwax",
  "04-tin-roof.deadwax",
  "05-spin-cycle.deadwax",
];

/** @returns {Promise<{file: string, text: string}[]>} */
export async function loadHouseRecords() {
  return Promise.all(
    HOUSE_RECORDS.map(async (file) => {
      const url = new URL(`examples/${file}`, import.meta.url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${file}`);
      return { file, text: await response.text() };
    }),
  );
}
