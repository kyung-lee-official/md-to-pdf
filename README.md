# md-to-pdf

Recursively convert Markdown files in `doc/` to PDFs in `build/`, preserving the folder structure.

## Requirements

- Node.js >= 22 (or Bun)
- Chromium for Playwright: `bun run pdf:install`

## Usage

```sh
bun install
bun run build
```

## Front matter

- `title`: document title (defaults to the file name)
- `css`: extra stylesheet path(s) to append, relative to the Markdown file
- `pdf`: options passed to Playwright's `page.pdf()` (for example `format`, `landscape`, `margin`)

Math is rendered server-side with KaTeX, so no CDN or browser-side JavaScript is required. Use `$...$`, `$$...$$`, `\(...\)`, or `\[...\]`.
