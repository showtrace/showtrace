# Showtrace website

The public website of Showtrace. One page that says what Showtrace is today, what is planned and where it is going, in the words of its brand guide, and shows every feature of the current build as a demonstration in the browser. Plain HTML, CSS and one script: no build step, no framework, no dependency, no fonts or scripts from other domains, no trackers.

The pages are in `site/`. GitHub Pages serves that folder through the workflow in `.github/workflows/pages.yml`.

## What this repository is, and is not

- It holds the website only. The product, its code and its working files live in the Showtrace repository, which is private until its owners have chosen a licence and a public home.
- The site is built from the owner files and the brand guide of the Showtrace repository, by the prompts kept there (`docs/prompts/website.md` for the page, `docs/prompts/website-design.md` for the design and the demonstrations). It is rebuilt from them when they change, and not edited apart from them.
- Its history is clean: this repository never held anything private, so it can be public from its first commit.

## The one script

`site/demonstrations.js` is the one script, served by the site itself and loaded as an enhancement: the page reads and works without it, and the feature cards then stand as text. With it, each card gets a demonstration drawn in the browser on a neutral stand-in screen, labelled as a demonstration and never styled as a screenshot, and the "Try it" section gets a sandbox where a visitor draws with the pen, the highlighter, the arrow and the fading ink and saves the result as a PNG.

- Each demonstration plays once when it comes into view and again on "Play again". Nothing loops. Under `prefers-reduced-motion` only the end state shows, and the control still works. When the tab is hidden, a play stops at its end state.
- Nothing leaves the browser. The script makes no request, sets no cookie and stores nothing; the PNG is the visitor's own download. The content security policy in the page allows scripts, styles and fonts from the site only, and `tools/check-site.ps1` reads the script for anything that would send or store.
- What the demonstrations show follows the design spec and the README of the build in the Showtrace repository. A demonstration that shows something the build does not do is a bug.

## Typeface

Atkinson Hyperlegible Next by the Braille Institute, under the SIL Open Font License 1.1, self-hosted in `site/fonts/` as two variable WOFF2 files (upright and italic, weight 200 to 800) with its licence text. The files are the web fonts of the upstream repository `googlefonts/atkinson-hyperlegible-next` (version 2.001, the `fonts/webfonts` folder at its commit of 2024-11-20, the same binaries Google Fonts serves). Checked at the source on 2026-10-06: weights 200 to 800 as one variable axis, italics for every weight, tabular and proportional figures (`tnum`, `pnum`), 362 code points including the Latin-1 Supplement and the Dutch ij.

## Preview

Serve `site/` from any static file server and open it in a browser, or open `site/index.html` from disk: every path in the page is relative. From disk the browser may refuse the font and the script under `file:`; a local server shows the page as Pages serves it.

Check by hand what a script cannot: both colour schemes, a 320 px wide window, the page with the keyboard only, reduced motion, the stroke that draws itself on the logo and the hero mark, each demonstration once and again on its control, the sandbox and its PNG, every link, and a browser console without errors.

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
- A custom domain comes later, once the owners have chosen one. Until then the site has no `CNAME` file and the address ends in the repository's name.

## What waits

- A real screenshot or a recording of real marks on a real screen, as proof that the Windows build is real. The page carries none for now; the demonstrations are drawn in the browser and say so.
- The contact line in the footer says that a way to reach us follows, until the owners choose what to show.
- The logo is a session's drawing of the brand guide's direction A. It needs a designer's pass and the 16 px tests.
- A Dutch page under `nl/` comes later, whole.

## Owners

Kees Leemeijer and Jarry Perez. All rights reserved until a licence is chosen.
