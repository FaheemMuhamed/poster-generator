---
name: seo-aeo
description: Check and improve Morva's search (SEO) and answer-engine (AEO) readiness — meta tags, structured data, crawlable fallback content, robots.txt, sitemap.xml, llms.txt and the web manifest. Use when the user says "SEO", "AEO", "GEO", "search ranking", "show up in ChatGPT/Perplexity/Google AI", "structured data", "schema.org", "meta tags", "sitemap", "robots.txt" or "llms.txt", or after changing the site's name, tagline, effect count or URLs.
---

# SEO and AEO for Morva

Morva is a single-page app on GitHub Pages (morva-studio.com). Views live in the hash
(`#explore`, `#about`, `#<mode>/<seed>`), so search engines see **one URL**. Everything a
crawler or AI engine learns comes from `index.html` and the files in `public/`.

Many AI crawlers (GPTBot, ClaudeBot, PerplexityBot) do not run JavaScript. Write the facts
they need into raw HTML, not only into React.

## Where things live

| What | File |
|---|---|
| Title, description, canonical, Open Graph, Twitter, JSON-LD | `index.html` `<head>` |
| Crawlable fallback content (replaced by React on load) | `index.html` inside `<div id="root">` |
| Crawler rules, incl. AI bots | `public/robots.txt` |
| URL list | `public/sitemap.xml` |
| Plain summary for LLMs | `public/llms.txt` |
| Install metadata, icons | `public/site.webmanifest`, `public/favicon.svg`, `public/apple-touch-icon.png` |
| Share image (1200×630) | `public/og.jpg` |

## Checklist

1. **Facts agree everywhere.** Effect count (`MODES.length` in `js/modes/index.js`), example
   count (`public/examples/examples.json`), font count (`FONTS_LIBRARY`), tagline and
   price ("free") must match across `index.html`, JSON-LD, `llms.txt` and the About page.
   Recount before editing:
   ```bash
   node -e "import('./js/modes/index.js').then(m=>console.log(m.MODES.length))"
   ```
2. **Title ≤ 60 chars, description 140–160 chars**, both naming what Morva is for
   (generative posters, p5.js, three.js, GLSL, designers).
3. **JSON-LD** in one `@graph`: `WebSite`, `Organization`, `WebApplication`
   (`applicationCategory: DesignApplication`, `offers.price: 0`, `featureList`) and
   `FAQPage`. FAQ answers must also appear as visible text (the fallback content and/or
   About page). Validate at https://validator.schema.org.
4. **Fallback content** in `#root`: one `<h1>`, a 2–3 sentence answer to "what is Morva",
   a short list of effects, and the FAQ as `<h2>`/`<p>`. Lead each answer with the direct
   answer in the first sentence — that is what answer engines quote.
5. **robots.txt** allows everything (including AI bots) and points to the sitemap.
   Bump `<lastmod>` in `sitemap.xml` when content changes.
6. **llms.txt**: H1 name, a `>` one-line summary, then short sections with links.
7. **Share preview**: `og:image` absolute URL, 1200×630, with `og:image:alt`.

## Don't

- Don't hide keyword lists or text that the app itself doesn't show.
- Don't add `FAQPage` questions that aren't answered on the page.
- Don't add hash URLs to the sitemap; Google ignores fragments.
