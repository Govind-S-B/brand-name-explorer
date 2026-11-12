# Design brief — boat.dev standard, applied to a compact naming tool

Reference captured 12 November 2026 in installed Chrome at 1440 px and 390 px
(iPhone 13 emulation, 2× DPR). Screenshots: [desktop](design-ref/boat-desktop.png),
[desktop full](design-ref/boat-desktop-full.png), [390 px](design-ref/boat-mobile.png),
[390 px full](design-ref/boat-mobile-full.png). Values below are computed styles
and the site's own CSS custom properties, not estimates from pixels.

We adopt the design *standard and language*. We do not adopt the brand. There is no logo,
pixel-art scenery, copy, ultramarine `#263fa9` or "Plex Art" pixel face. All
three text faces boat.dev uses are SIL OFL, so we self-host subsets of the same
families. IBM Plex is renamed "BNE Mono" because "Plex" is a Reserved Font Name.

## What makes boat.dev distinctive

| # | Principle | Evidence on boat.dev |
| --- | --- | --- |
| 1 | **Hard edges and hairlines.** No shadows, gradients or rounded corners. | 1 `border-radius` in the whole page (a 9999 px dot). Frames are 1 px `--n-3 #e0e0e0` or tinted-blue lines. |
| 2 | **One saturated ink, used as a block.** It is never a tint wash. | 10-step ramp around `#263fa9`, plus a neutral ramp from `#fefefe` to `#060606`. Selected options, highlighted table rows and CTAs are solid fills with white text: inverse video. |
| 3 | **Three typographic voices, each with a job.** | Funnel Display (headlines, 500/400, tracking −0.02 to −0.03 em). Inter (prose and controls, 16/24, 14/20, 400). IBM Plex Mono (data, labels, prompts and captions, 13/16, 14/20). Mono is the most-used face: 202 text nodes against 115 in Inter. |
| 4 | **The mono caption as a system.** | Lowercase labels above every figure: `my-app · ubuntu`, `$ boat desktop my-app`, `step 1 of 3`, `50 VMs at once · one boat = …`. It uses `·` separators and `→` arrows. |
| 5 | **Terminal metaphors as UI.** | OS tabs sit flush on a command block, with the active tab filled. There is a blinking block cursor (`steps`, `step-end`) and a tmux status bar (`[boat] 0:docs 1:api …`) as the footer. |
| 6 | **Dense data views inside a calm page.** The pricing calculator is the closest analogue to this app. | It uses a label column, flat square segments (tinted grey, selected = solid), a live result, a mono table with the selected row filled, and dithered and dotted comparison bars. |
| 7 | **Pixel and dither texture is the only ornament.** | Images are pixel art. Bars are drawn as dot patterns, not gradients. |
| 8 | **Fast, quiet motion.** | 120–150 ms colour and background transitions on `cubic-bezier(.37,0,.63,1)`. New lines fade up 4 px in 180 ms, and the cursor blinks with `step-end`. `prefers-reduced-motion` switches all of it off. |
| 9 | **Visible focus with the accent.** | `:focus-visible { outline: 2px solid accent; outline-offset: 2px }` everywhere. |
| 10 | **Mobile keeps structure and only scales type.** | Margins are 16 px (48 px on desktop), h1 drops from 56 to 34 px and the mono captions survive. Tabs stay inline, and nothing turns into a hamburger. |

What we do **not** take: boat.dev is a marketing page with 64–96 px section
padding and a full-bleed illustration. This app is a tool, so its density comes from
boat.dev's *data sections* (calculator, benchmark list, pricing table), not
from its hero.

## How each principle maps onto the explorer

1. **Edges.** Every control, row and panel is square, divided by 1 px `#e3e3e3`
   hairlines. There are no cards and no shadows. The old 132 px name cards become 44 px rows.
2. **Ink.** Our own accent is a saturated green signal `#0d6b3a` (6.6:1 on white),
   with a short ramp, so it is not boat.dev's blue. The meaning is strict:
   - **green** means "go": the Generate action, *possibly available* rows, progress and focus;
   - **near-black inverse fill** means *selected*: the mood, the active tab;
   - **red `#b42318`** means error.

   Registered names drop to grey, so available names stand out when scanning.
3. **Voices.**
   - **Funnel Display 500:** the wordmark, panel titles and every generated name
     (the "product").
   - **Inter 400:** labels and prose.
   - **BNE Mono:** statuses, counts, captions, rank numbers, summaries, the
     status line and the tool-tab strip.
4. **Mono captions.** Folded sections summarise their state in mono, e.g.
   `6 letters · auto syllables · dials from mood` and `live · rdap + dns`.
   The run line uses the same grammar, e.g. `12 / 24 checked · rdap 6 · dns 24`.
5. **Terminal metaphors.**
   - The tools are an inline mono tab strip with the active tab inverse-filled
     (OS-tab pattern).
   - Running checks show a blinking block cursor.
   - The footer is a one-line status bar.
   - The connection badge in the header reports `online` / `offline`.
6. **Calculator density.** Desktop is a two-pane tool: a sticky control rail
   (moods as a 4-column segmented grid, action row, folds) and a results pane of
   multi-column rows. Mobile stacks the same rail above a single-column list.
7. **Dither.** The lookup progress meter is a 2 px dither pattern that fills
   solid green. The shortlist toggle is a 7×6 pixel heart drawn in CSS: outline
   when unsaved, solid when saved. No images are loaded.
8. **Motion.**
   - 120 ms colour transitions.
   - Status badges fade up 2 px when a result lands.
   - Blinking cursor while checking.
   - All of it is disabled under `prefers-reduced-motion`.
9. **Focus.** 2 px green outline, 2 px offset, on every interactive element.
10. **Mobile first-class.**
    - At 390 px the header, tabs, moods, action row and two folds fit in about 330 px.
    - Results are 44 px rows, so about a dozen sit above the fold.
    - Every hit area is ≥ 44 px even where the visual is smaller, and inputs use
      16 px text so iOS does not zoom.

## Load budget

Three WOFF2 subsets (ASCII plus the UI's punctuation and arrows) total 17.4 KB,
loaded with `font-display: swap`. Metric-matched local fallbacks (`size-adjust`,
ascent and descent overrides computed by `scripts/fonts.py` maths against Arial and
Courier New) keep layout shift near zero while fonts arrive. The JS budget is
unchanged: the redesign is CSS plus markup.
