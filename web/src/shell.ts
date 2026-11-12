/* Static app shell, rendered into index.html at build time (see vite.config.ts)
   so the controls paint before any JavaScript runs. main.ts only wires it up. */
import { MOODS, DIALS } from "./core/generator";
const icon = { arrow: "→" };
const moodNames = Object.keys(MOODS);
export const shell = () => `
<main>
<section id="panel-explore" class="explore" role="tabpanel" aria-labelledby="tab-explore">
<h1 class="sr-only">Explore names by sound</h1>
<div class="rail">
<form id="generate-form">
<fieldset class="mood-field"><legend class="cap">mood <span aria-hidden="true">·</span> blend</legend><div class="moods" role="group" aria-label="Mood">${moodNames
  .map(
    (m, i) =>
      `<button type="button" data-mood="${m}" aria-pressed="${i === 0}"><i class="swatch mood-${m}" aria-hidden="true"></i>${m}</button>`,
  )
  .join(
    "",
  )}<label class="blend-cell"><span class="sr-only">Blend with</span><span id="blend-face" aria-hidden="true">+ blend</span><select id="blend"><option value="">+ blend</option>${moodNames
  .map((m) => `<option value="${m}">+ ${m}</option>`)
  .join("")}</select></label></div></fieldset>
<div class="actions"><label class="mini"><span>names</span><select id="count"><option>24</option><option>50</option><option>200</option><option>1000</option><option>4000</option></select></label><label class="mini"><span>page</span><input id="page" type="number" min="1" value="1" required></label><button class="primary" id="generate" type="submit">Generate <span aria-hidden="true">${icon.arrow}</span></button></div>
<details id="sound-controls" class="fold"><summary><span class="fold-title">Sound</span><span class="fold-value" id="sound-summary">6 letters · auto syl</span></summary><div class="fold-body"><div class="dials">${DIALS.map(
  (d, i) =>
    `<label class="dial" for="${d}"><span class="dial-name">${d}</span><input id="${d}" type="range" min="0" max="10" step="0.1" value="${[1, 3, 2][i]}"><output id="${d}-value" for="${d}">${[1, 3, 2][i]}</output><span class="dial-ends">${[
      ["Restful", "Energetic"],
      ["Light", "Heavy"],
      ["Familiar", "Unusual"],
    ][i]
      .map((s) => `<small>${s}</small>`)
      .join("")}</span></label>`,
).join("")}</div>
<div class="form-grid"><label>Letters<input id="length" type="number" min="3" max="14" value="6" required></label><label>Syllables<select id="syllables"><option value="">Automatic</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label><label>Opening<select id="opening"><option value="any">Any opening</option><option value="vowel">Vowel</option><option value="consonant">One consonant</option><option value="cluster">Consonant cluster</option></select></label><label>Ending<select id="ending"><option value="">From mood</option><option value="open">Vowel</option><option value="closed">Consonant</option><option value="either">Either</option></select></label><label>Blend amount<input id="blend-amount" type="number" min="0" max="1" step="0.1" value="0.3"></label></div><p class="fine-print">Dials guide sound combinations. They are experimental preferences, not measured emotions.</p></div></details>
<details id="domain-controls" class="fold"><summary><span class="fold-title">Domains</span><span class="fold-value" id="domain-summary">live .com checks</span></summary><div class="fold-body"><div class="check-grid"><label class="check"><input id="check-domains" type="checkbox" checked> Check domains after generating</label><label class="check"><input id="filter-available" type="checkbox"> Only possibly available names</label><label class="check"><input id="refresh" type="checkbox"> Refresh this search with fresh checks</label><label class="check"><input id="use-dns" type="checkbox" checked> Use the live DNS pre-filter</label></div><p class="fine-print">Every “possibly available” result is RDAP-confirmed. A registrar must confirm purchase availability. Saved checks can become stale.</p></div></details>
</form>
</div>
<div class="stage" id="stage" data-state="loading">
<div class="results-head"><h2>Names <span class="count" id="result-count">24</span></h2><span class="cap" id="page-label">Page 1</span><div class="run-controls"><button id="pause" type="button" hidden>Pause</button><button id="resume" type="button" hidden>Resume checks</button></div></div>
<p id="run-status" class="status-line" role="status" aria-live="polite">Generated on your device. No domain checks yet.</p>
<div class="meter" aria-hidden="true"><i id="meter"></i></div>
<ul id="results" class="results" aria-label="Generated names"></ul>
<div class="page-actions"><button id="previous" type="button"><span aria-hidden="true">←</span> Previous</button><button id="next" type="button">Next page <span aria-hidden="true">→</span></button></div>
<details class="advanced fold"><summary><span class="fold-title">Advanced</span><span class="fold-value">seed · engine · lookup tuning · cache · csv</span></summary><div class="fold-body"><div class="form-grid"><label>Seed<input id="seed" value="42" inputmode="numeric" pattern="-?[0-9]+" form="generate-form" required></label><label>Engine<select id="engine"><option value="">Sound moods</option><option value="calm">Original calm</option><option value="flowing">Original flowing</option><option value="expansive">Original expansive</option></select></label><label>RDAP connections<input id="rdap-concurrency" type="number" min="1" max="6" value="6"></label><label>RDAP attempts / sec<input id="rdap-rate" type="number" min="1" max="160" value="30"></label><label>DNS slots / provider<input id="dns-concurrency" type="number" min="1" max="24" value="12"></label><label>DNS queries / sec / provider<input id="dns-rate" type="number" min="1" max="160" value="40"></label><label>DNS timeout (ms)<input id="dns-timeout" type="number" min="100" max="30000" value="2000"></label><label>Idle RDAP fallback (ms)<input id="hedge-delay" type="number" min="0" max="30000" value="250"></label></div><div class="button-row"><button id="inspect-cache" type="button">Inspect cache</button><button id="clear-cache" type="button">Clear lookup cache</button><button id="export-results" type="button">Export results CSV</button></div><p id="cache-status" class="fine-print">Saved names are separate from the lookup cache. Clearing this cache preserves your shortlist and saved search pages.</p></div></details>
</div>
</section>
${[
  [
    "reverse",
    "Reverse finder",
    "Find the sounds, structure and possible settings behind a reference name.",
  ],
  [
    "inverter",
    "Inverter",
    "Fit an exact generator spelling to the same forward sound model.",
  ],
  [
    "substitutions",
    "Substitutions",
    "Explore allowed spellings near a pronunciation, with explicit sound changes.",
  ],
]
  .map(
    ([id, title, copy]) =>
      `<section id="panel-${id}" role="tabpanel" aria-labelledby="tab-${id}" hidden class="tool-panel"><div class="tool-head"><h1>${title}</h1><p class="lede">${copy}</p></div><form class="tool-form" data-mode="${id}"><label class="word">${id === "inverter" ? "Generator spelling" : "Reference name"}<input name="word" value="${id === "inverter" ? "lemoru" : "figma"}" maxlength="80" required autocomplete="off" autocapitalize="none" spellcheck="false"></label>${id !== "inverter" ? `<label>Reading source<select name="reading-mode"><option value="dictionary">Dictionary, then spelling</option><option value="reading">Supplied reading / syllables</option><option value="phones">Supplied ARPABET sounds</option></select></label><label>Supplied reading<input name="reading-value" placeholder="she-en, or SH IY EH N" maxlength="200" autocomplete="off" autocapitalize="none" spellcheck="false"></label>` : ""}${id === "substitutions" ? '<label class="narrow">Suggestions<input name="suggestion-count" type="number" min="1" max="20" value="5"></label>' : ""}<button class="primary" type="submit">${id === "reverse" ? "Find settings" : id === "inverter" ? "Fit spelling" : "Explore"} <span aria-hidden="true">${icon.arrow}</span></button></form><p class="tool-status status-line" role="status"></p><div class="tool-result"></div><p class="fine-print">${id === "inverter" ? "Fits are grid-search candidates, not recovered original settings or emotional ratings." : id === "substitutions" ? "A bounded phoneme-edit search, not a guarantee of the nearest or best name. Suggestions do not change whether the original fits." : "Dictionary readings are suggestions. Supply your intended pronunciation to override them. Representation gaps are reported explicitly."}</p></section>`,
  )
  .join("")}
<section id="panel-saved" role="tabpanel" aria-labelledby="tab-saved" hidden class="tool-panel"><div class="tool-head"><h1>Shortlist</h1><p class="lede">Names you want to come back to. Keep a downloaded backup: browser storage can be cleared or evicted, and the lookup cache is not your archive.</p></div><div class="button-row"><button id="backup" class="primary" type="button">Download backup <span aria-hidden="true">↓</span></button><label class="file-button">Import backup<input id="import" type="file" accept="application/json,.json"></label></div><p id="saved-status" class="status-line" role="status"></p><ul id="saved-list" class="results" aria-label="Saved names"></ul></section>
</main><div id="notice" role="alert" hidden></div>`;
