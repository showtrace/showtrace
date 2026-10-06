# Showtrace website

The public website of Showtrace. One page that says what Showtrace is today, what is planned and where it is going, in the words of its brand guide. Plain HTML and CSS: no build step, no framework, no dependency, no JavaScript, no fonts or scripts from other domains, no trackers.

The pages are in `site/`. GitHub Pages serves that folder through the workflow in `.github/workflows/pages.yml`.

## What this repository is, and is not

- It holds the website only. The product, its code and its working files live in the Showtrace repository, which is private until its owners have chosen a licence and a public home.
- The site is built from the owner files and the brand guide of the Showtrace repository, by the prompt kept there (`docs/prompts/website.md`). It is rebuilt from them when they change, and not edited apart from them.
- Its history is clean: this repository never held anything private, so it can be public from its first commit.

## Preview

Open `site/index.html` in a browser. Every path in the page is relative, so it works from disk.

Check by hand what a script cannot: both colour schemes, a 320 px wide window, the page with the keyboard only, reduced motion, the stroke that draws itself on the logo, and every link.

## Check

```powershell
powershell -ExecutionPolicy Bypass -File tools\check-site.ps1
```

It reads the site for keyboard characters only (no em dashes, curly quotes, arrows or ellipses), for the words the brand guide avoids, for scripts and for resources from other domains, and it looks for the files the site is made of. The workflow runs the same script before every deployment.

## Publish

An owner does this; a session never publishes.

1. Create a public repository on GitHub and push `main` of this repository to it. Which account or organisation holds it is the owners' choice.
2. In the repository, open Settings, then Pages, and under Source choose GitHub Actions.
3. Push, or start the workflow from the Actions tab. The workflow runs the checks and deploys `site/`. The address of the page is shown on the run, under the `github-pages` environment.
4. A custom domain comes later, once the owners have chosen one. Until then the site has no `CNAME` file.

## What waits

- The screenshots are labelled placeholders. Real screenshots of real marks on a real screen replace them.
- The contact line in the footer is a placeholder until the owners choose what to show.
- The logo is a session's drawing of the brand guide's direction A. It needs a designer's pass and the 16 px tests.
- The page uses the system font stack until the typeface is decided.
- A Dutch page under `nl/` comes later, whole.

## Owners

Kees Leemeijer and Jarry Perez. All rights reserved until a licence is chosen.
