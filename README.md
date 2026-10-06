# Showtrace website

The public website of Showtrace. One page that says what Showtrace is today, what is planned and where it is going, in the words of its brand guide, and shows every feature of the current build as a demonstration in the browser. Plain HTML, CSS and one script: no build step, no framework, no dependency, no fonts or scripts from other domains, no trackers.

The pages are in `site/`. GitHub Pages serves that folder through the workflow in `.github/workflows/pages.yml`.

## What this repository is, and is not

- It holds the website only. The product, its code and its working files live in the Showtrace repository, which is private until its owners have chosen a licence and a public home.
- The site is built from the owner files and the brand guide of the Showtrace repository, by the prompts kept there (`docs/prompts/website.md` for the page, `docs/prompts/website-design.md` for the design and the demonstrations). It is rebuilt from them when they change, and not edited apart from them.
- Its history is clean: this repository never held anything private, so it can be public from its first commit.

## The one script

`site/demonstrations.js` is the one script, served by the site itself and loaded as an enhancement: the page reads and works without it, and the feature cards then stand as text. With it, each card gets a demonstration drawn in the browser on a neutral stand-in screen, labelled as a demonstration and never styled as a screenshot, and the "Try it" section gets a sandbox where a visitor draws with the pen, the highlighter, the arrow and the fading ink and saves the result as a PNG.

- Each demonstration plays once when it comes into view and again on its play control, which reads Stop while a play moves. Stop, a hidden tab, the picture leaving the view and reduced motion turned on while the page is open each end a play at its end state. Nothing loops. Under `prefers-reduced-motion` only the end state shows, and the controls still work. A polite live region tells a screen reader that a play starts and how it ends.
- Nothing leaves the browser. The script makes no request, sets no cookie and stores nothing; the PNG is the visitor's own download. The content security policy in the page allows scripts, styles and fonts from the site only, and `tools/check-site.ps1` reads the script for anything that would send or store.
- What the demonstrations show follows the design spec and the README of the build in the Showtrace repository. A demonstration that shows something the build does not do is a bug.

## Typeface

Atkinson Hyperlegible Next by the Braille Institute, under the SIL Open Font License 1.1, self-hosted in `site/fonts/` as two variable WOFF2 files (upright and italic, weight 200 to 800) with its licence text. The files are the web fonts of the upstream repository `googlefonts/atkinson-hyperlegible-next` (version 2.001, the `fonts/webfonts` folder at its commit of 2024-11-20, the same binaries Google Fonts serves). Checked at the source on 2026-10-06: weights 200 to 800 as one variable axis, italics for every weight, tabular and proportional figures (`tnum`, `pnum`), 362 code points including the Latin-1 Supplement and the Dutch ij.

The page preloads the upright file; the italic one is not preloaded, because the page sets no italic text. `font-display: swap` shows the text at once in a fallback face: Arial, or Liberation Sans or Arimo, which have Arial's widths, scaled to the widths of Atkinson Hyperlegible Next and given its vertical metrics. Measured in Chromium on Windows on 2026-10-06: when the face arrives, nothing on the page moves at 768 and 1280 px wide; at 320 px, 4 of about 95 blocks of text break one line at another word. Where Arial and its clones are missing, as on Android, the platform's own font stands in unadjusted.

## The head

- Every file the page loads is named by a relative path. Only the canonical link and the sharing tags name an address, the public one, `https://showtrace.github.io/showtrace/`, and they load nothing. When the owners choose a domain, those addresses change together with the `-Address` of the check, which refuses any other.
- The theme colour follows the colour scheme: paper (`#FFFFFF`) in light, slate (`#202124`) in dark.
- The sharing tags (Open Graph, and the Twitter card that reads them) give a chat or a social site the title, the description and `site/og-image.png`, 1200 by 630: the logo of the header in the brand teal on paper, with the hero line. A logo and words, no marks, so that it never reads as a screenshot. A browser that shows the page never loads it; only a site that previews a shared link does.
- The picture is rendered from `tools/og-image.svg`, which loads the font from `site/fonts/`. To render it again, after the logo or the line changes: serve the repository's root folder with any static file server and take a 1200 by 630 screenshot of the SVG with a headless Chromium browser, for example `msedge --headless=new --window-size=1200,630 --force-device-scale-factor=1 --screenshot=site\og-image.png http://localhost:8000/tools/og-image.svg`.

## The 404 page

`site/404.html` is the page GitHub Pages serves for an address under the site that does not exist, at any depth. So it names its files from the root of the public address (`/showtrace/styles.css`), and the check holds those paths to that address. It loads no script, says what happened and links to the front page. A preview of `site/` at a server's root shows it without its styles; served under `/showtrace/`, it looks as it does on Pages.

There is no `robots.txt`: crawlers read one only at the root of a host, and Pages serves this site under `/showtrace/`, so one here would not be read. It can come with a domain.

## Print

A printed page is light on white paper, whatever the visitor's colour scheme: the dark scheme applies to screens only. Print leaves out what works only on a screen (the skip link, the section links, the hero's links and mark, the controls of the demonstrations and the sandbox, the link back to the top) and keeps the text, each demonstration as it stands and its "Demonstration" label, which keeps its dark plate. Cards, quotes and the trace do not break across pages.

## Preview

Serve `site/` from any static file server and open it in a browser, or open `site/index.html` from disk: every file the page loads is named by a relative path. From disk the browser may refuse the font and the script under `file:`; a local server shows the page as Pages serves it.

Check by hand what a script cannot: both colour schemes, a 320 px wide window, the page with the keyboard only, reduced motion, the stroke that draws itself on the logo and the hero mark, each demonstration once and again on its control, the sandbox and its PNG, every link, a print preview, the 404 page at a missing address, and a browser console without errors.

A headless Chromium screenshot taken with `--virtual-time-budget` shows no demonstration playing: the page preloads its font, and Chromium then makes no frame until the virtual time runs out (seen in Edge 154). A screenshot without that switch, in real time, shows them, and with `--force-prefers-reduced-motion` each one's end state.

## Check

```powershell
powershell -ExecutionPolicy Bypass -File tools\check-site.ps1
```

It reads the site for keyboard characters only (no em dashes, curly quotes, arrows or ellipses), for the words the brand guide avoids, for any script other than the site's own, for inline scripts, handlers and styles, for anything in the script that would send or store, and for resources from other domains, in the pages, the SVG files and the stylesheet. It holds the content security policy of every page to the site's strictness, before anything the page loads: `default-src`, `base-uri` and `form-action` are `'none'`, every source is `'self'` or `'none'`, and a page without the script says `script-src 'none'`. It tells an address from a resource: a link to another site loads nothing until it is followed and may stand in a page, while the canonical link and the sharing tags may name only the public address, `https://showtrace.github.io/showtrace/` (the script's `-Address` parameter, which changes with the domain). It looks for the files the site is made of, and checks that every file and id the pages, the SVG files and the stylesheet name exists, in the case it is named in, as GitHub Pages serves it. The workflow runs the same script before every deployment.

The Showtrace repository runs a second check over this folder when it sits next to it (`tools/check-repo.ps1` there): private terms, e-mail addresses, typography, the one sentence on the front page, and that every feature card's status word matches the row it rests on in `product/problem-solutions.md`.

## Publish

The public home is `https://github.com/showtrace/showtrace`, in the GitHub organisation `showtrace`. GitHub Pages serves `site/` at `https://showtrace.github.io/showtrace/`, with GitHub Actions as its source. Both were set up on 2026-10-06 on the owners' word; a session publishes nothing on its own.

- Every push to `main` runs the checks and deploys. The workflow can also be started from the Actions tab.
- Work happens on a branch; a pull request to `main` is merged by an owner, and the merge publishes.
- A push that changes the workflow file needs a GitHub token with the `workflow` scope. With the GitHub CLI: `gh auth refresh -h github.com -s workflow`.
- A custom domain comes later, once the owners have chosen one. Until then the site has no `CNAME` file and the address ends in the repository's name. With the domain, the canonical link and the sharing tags in the page change, and the `-Address` of `tools/check-site.ps1` with them.

## What waits

- A real screenshot or a recording of real marks on a real screen, as proof that the Windows build is real. The page carries none for now; the demonstrations are drawn in the browser and say so.
- The contact line in the footer says that a way to reach us follows, until the owners choose what to show.
- The logo is a session's drawing of the brand guide's direction A. It needs a designer's pass and the 16 px tests. The sharing picture `site/og-image.png` shows it, so it is rendered again when the logo changes.
- A Dutch page under `nl/` comes later, whole.

## Owners

Kees Leemeijer and Jarry Perez. All rights reserved until a licence is chosen.
