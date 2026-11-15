// Fills an experiment's version link from /experiments.json, which the Pages
// build writes. Usage, inside the experiment's <footer>:
//
//   <a data-version hidden></a>
//   <script type="module" src="../version.mjs"></script>
//
// The link shows the short SHA of the last commit touching the experiment and
// points to it on GitHub, after a " · " separator. Both stay hidden when the
// file isn't there, for example when serving the repository rather than the
// built site.

const link = document.querySelector("a[data-version]");
const slug = location.pathname.split("/").filter(Boolean)[0];

if (link && slug) {
  try {
    const response = await fetch(new URL("experiments.json", import.meta.url));
    if (response.ok) {
      const experiment = (await response.json()).find((e) => e.slug === slug);
      if (experiment?.sha && experiment.url) {
        link.href = experiment.url;
        link.textContent = experiment.sha.slice(0, 7);
        link.title = `Last change to this experiment, on GitHub`;
        link.before(" · ");
        link.hidden = false;
      }
    }
  } catch {
    // Offline or not built: no version link.
  }
}
