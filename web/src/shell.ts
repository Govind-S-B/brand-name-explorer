/* Static app shell, rendered into index.html at build time (see vite.config.ts)
   so the first screen paints before any JavaScript runs. main.ts wires it up.
   Information architecture: docs/ux-v2.md. */
import { MOODS, DIALS } from "../../core/profile";
const moods = Object.keys(MOODS);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const close = `<button type="button" class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>`;
const fold = (id: string, title: string, value: string, body: string, open = false) =>
  `<details id="${id}" class="fold"${open ? " open" : ""}><summary><span class="fold-title">${title}</span><span class="fold-value" id="${id.split("-")[0]}-summary">${value}</span></summary><div class="fold-body">${body}</div></details>`;
const toggle = (id: string, title: string, help: string, on: boolean) =>
  `<label class="switch"><span><b>${title}</b><small>${help}</small></span><input id="${id}" type="checkbox" role="switch"${on ? " checked" : ""}></label>`;
const field = (label: string, control: string) => `<label>${label}${control}</label>`;
const number = (id: string, min: number, max: number, value: number) =>
  `<input id="${id}" type="number" min="${min}" max="${max}" value="${value}">`;
const ends = [
  ["Restful", "Energetic"],
  ["Light", "Heavy"],
  ["Familiar", "Unusual"],
];

const tune = `<dialog id="tune" class="sheet tune" aria-labelledby="tune-title"><form id="generate-form">
<div class="sheet-head"><h2 id="tune-title">Tune</h2>${close}</div>
<div class="sheet-body">
${fold(
  "mood-controls",
  "Mood",
  "Calm",
  `<div class="moods" role="group" aria-label="Mood">${moods
    .map(
      (m, i) =>
        `<button type="button" class="chip" data-mood="${m}" aria-pressed="${i === 0}"><i class="swatch mood-${m}" aria-hidden="true"></i>${cap(m)}</button>`,
    )
    .join("")}</div>
<div class="form-grid">${field(
    "Blend with",
    `<select id="blend"><option value="">Nothing</option>${moods.map((m) => `<option value="${m}">${cap(m)}</option>`).join("")}</select>`,
  )}<label>Blend amount <output id="blend-amount-value" for="blend-amount">0.3</output><input id="blend-amount" type="range" min="0" max="1" step="0.1" value="0.3"></label></div>`,
  true,
)}
${fold(
  "sound-controls",
  "Sound",
  "From mood · auto syllables",
  `<div class="dials">${DIALS.map(
    (d, i) =>
      `<label class="dial" for="${d}"><span class="dial-name">${cap(d)}</span><output id="${d}-value" for="${d}">${[1, 3, 2][i]}</output><input id="${d}" type="range" min="0" max="10" step="0.1" value="${[1, 3, 2][i]}"><span class="dial-ends"><small>${ends[i][0]}</small><small>${ends[i][1]}</small></span></label>`,
  ).join("")}<button type="button" id="reset-dials" class="text-btn">Reset dials to mood</button></div>
<div class="form-grid">${field(
    "Syllables",
    `<select id="syllables"><option value="">Automatic</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>`,
  )}${field(
    "Opening",
    `<select id="opening"><option value="any">Any opening</option><option value="vowel">Vowel</option><option value="consonant">One consonant</option><option value="cluster">Consonant cluster</option></select>`,
  )}${field(
    "Ending",
    `<select id="ending"><option value="">From mood</option><option value="open">Vowel</option><option value="closed">Consonant</option><option value="either">Either</option></select>`,
  )}</div><p class="fine-print">Dials guide sound combinations. They are experimental preferences, not measured emotions.</p>`,
)}
${fold(
  "spelling-controls",
  "Spelling",
  "6 letters",
  `<label class="stepper-field" for="length">Letters</label><div class="stepper"><button type="button" data-step="-1" aria-label="Fewer letters">−</button><input id="length" type="number" min="3" max="14" value="6" required><button type="button" data-step="1" aria-label="More letters">+</button></div>`,
)}
${fold(
  "domain-controls",
  "Domains",
  "Available only",
  `${toggle("filter-available", "Only possibly available", "Hide registered .com names, as the CLI does by default.", true)}${toggle("check-domains", "Check .com availability", "Off generates names without any lookups.", true)}${toggle("use-dns", "DNS pre-filter", "Faster. Names with DNS records skip the registry check.", true)}${toggle("refresh", "Fresh lookups", "Recheck this search instead of reusing saved results.", false)}<p class="fine-print">Every “possibly available” name is RDAP-confirmed. A registrar must confirm it can be bought, and saved checks can become stale.</p>`,
)}
${fold(
  "advanced-controls",
  "Advanced",
  "20 per page · seed 42",
  `<div class="form-grid">${field(
    "Names per page",
    `<select id="count"><option>20</option><option>50</option><option>200</option><option>1000</option><option>4000</option></select>`,
  )}${field("Start at page", `<input id="page" type="number" min="1" value="1" required>`)}${field(
    "Seed",
    `<input id="seed" value="42" inputmode="numeric" pattern="-?[0-9]+" required>`,
  )}</div>
<details class="subfold"><summary>Lookup tuning</summary><div class="form-grid">${field("RDAP connections", number("rdap-concurrency", 1, 6, 6))}${field("RDAP attempts / sec", number("rdap-rate", 1, 160, 30))}${field("DNS slots / provider", number("dns-concurrency", 1, 24, 12))}${field("DNS queries / sec", number("dns-rate", 1, 160, 40))}${field("DNS timeout (ms)", number("dns-timeout", 100, 30000, 2000))}${field("Idle RDAP fallback (ms)", number("hedge-delay", 0, 30000, 250))}</div></details>
<div class="button-row"><button id="inspect-cache" type="button" class="pill-btn">Inspect cache</button><button id="clear-cache" type="button" class="pill-btn">Clear lookup cache</button><button id="export-results" type="button" class="pill-btn">Export CSV</button></div>
<p id="lookup-stats" class="fine-print"></p><p id="cache-status" class="fine-print">Saved names are separate from the lookup cache. Clearing it keeps your shortlist.</p>`,
)}
</div>
<div class="sheet-foot"><button class="primary wide" id="generate" type="submit">Show names</button></div>
</form></dialog>`;

const panel = (id: string, title: string, lede: string, body: string) =>
  `<section id="panel-${id}" class="panel" role="tabpanel" aria-labelledby="tab-${id}" hidden><div class="page-head"><h1>${title}</h1><p class="lede">${lede}</p></div>${body}</section>`;

export const shell = () => `<main>
<section id="panel-explore" class="panel" role="tabpanel" aria-labelledby="tab-explore">
<div class="page-head"><h1 id="feed-title">Names that feel <button type="button" class="chip mood-picker" id="mood-picker" aria-label="calm: tune mood and settings" aria-haspopup="dialog" aria-controls="tune" aria-expanded="false"><i class="swatch mood-calm" id="mood-swatch" aria-hidden="true"></i><span id="mood-label">calm</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button></h1></div>
${tune}
<div class="stage" id="stage" data-state="loading">
<div class="statusline"><p id="run-status" role="status" aria-live="polite">Finding available .com names…</p><button id="pause" type="button" class="text-btn" hidden>Pause</button><button id="resume" type="button" class="text-btn" hidden>Resume</button></div>
<div class="meter" aria-hidden="true"><i id="meter"></i></div>
<h2 class="sr-only">Names</h2><ul id="results" class="feed" aria-label="Names" data-filtered="true"></ul>
<div class="skeletons" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
<div class="empty"><p><b>No available names on this page.</b></p><p>Tap the mood above to change settings, or load the next page.</p></div>
<button id="next" type="button" class="secondary wide">Load more names</button>
</div>
</section>
${panel(
  "reverse",
  "Reverse",
  "Type a name you like to see the sound behind it, and the settings that make names like it.",
  `<form class="tool-form" data-mode="reverse"><div class="searchbox"><label class="sr-only" for="reverse-word">Reference name</label><input id="reverse-word" name="word" placeholder="Type a name, like Figma" maxlength="80" required autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"><button type="submit" class="primary round" aria-label="Find the sound"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></div>
<details class="fold pron"><summary><span class="fold-title">Pronunciation</span><span class="fold-value">Dictionary, then spelling</span></summary><div class="fold-body form-grid">${field(
    "Reading source",
    `<select name="reading-mode"><option value="dictionary">Dictionary, then spelling</option><option value="reading">Supplied reading or syllables</option><option value="phones">Supplied ARPABET sounds</option></select>`,
  )}${field("Supplied reading", `<input name="reading-value" placeholder="she-en, or SH IY EH N" maxlength="200" autocomplete="off" autocapitalize="none" spellcheck="false">`)}</div></details></form>
<p class="tool-status status-line" role="status"></p><div class="tool-result"></div>
<div class="follow" hidden><button type="button" class="pill-btn" data-follow="substitutions">Nearby spellings</button><button type="button" class="pill-btn" data-follow="inverter">Exact fit</button></div>
<div class="tool-more"></div>
<p class="fine-print">Dictionary readings are suggestions. Supply your intended pronunciation to override them. Fits are grid-search candidates, not recovered settings or emotional ratings.</p>`,
)}
${panel(
  "saved",
  "Shortlist",
  "Saved in this browser. Download a backup to keep them safe.",
  `<div class="head-actions"><button id="backup" type="button" class="pill-btn">Download backup</button><label class="pill-btn file-button">Import backup<input id="import" type="file" accept="application/json,.json"></label></div>
<p id="saved-status" class="status-line" role="status"></p><h2 class="sr-only">Saved names</h2><ul id="saved-list" class="feed" aria-label="Saved names"></ul>`,
)}
<div id="notice" role="alert" hidden></div>
</main>`;
