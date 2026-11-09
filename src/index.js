import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import { katex } from "@mdit/plugin-katex";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);

const rootPath = process.cwd();
const docPath = path.resolve(rootPath, "doc");
const buildPath = path.resolve(rootPath, "build");
const concurrency = 4;

const katexDistPath = path.join(path.dirname(require.resolve("katex/package.json")), "dist");
const katexFontsUrl = `${pathToFileURL(path.join(katexDistPath, "fonts")).href}/`;
const katexCss = fs
	.readFileSync(path.join(katexDistPath, "katex.min.css"), "utf8")
	.replaceAll("url(fonts/", `url(${katexFontsUrl}`);

const baseCss = `
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
	margin: 0;
	color: #1f2328;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	font-size: 12pt;
	line-height: 1.6;
}
main { max-width: 100%; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; page-break-after: avoid; }
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #d0d7de; }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #d0d7de; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
p, ul, ol { margin: 0 0 1em; }
ul, ol { padding-left: 2em; }
a { color: #0969da; text-decoration: none; }
code {
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
	font-size: 0.875em;
}
:not(pre) > code { background: #eff1f3; padding: 0.15em 0.35em; border-radius: 4px; }
pre {
	margin: 0 0 1em;
	padding: 12px 14px;
	background: #f6f8fa;
	border-radius: 6px;
	overflow-x: auto;
	white-space: pre-wrap;
	word-wrap: break-word;
	page-break-inside: avoid;
}
pre code { background: none; padding: 0; }
blockquote {
	margin: 0 0 1em;
	padding: 0 1em;
	color: #57606a;
	border-left: 4px solid #d0d7de;
}
table { width: 100%; margin: 0 0 1em; border-collapse: collapse; page-break-inside: avoid; }
th, td { padding: 0.4em 0.6em; text-align: left; border: 1px solid #d0d7de; }
th { background: #f6f8fa; }
img { max-width: 100%; height: auto; }
hr { height: 1px; margin: 2em 0; border: 0; background: #d0d7de; }
.katex-display { overflow-x: auto; overflow-y: hidden; }
`;

const md = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: true,
});

md.use(katex, {
	delimiters: "all",
	throwOnError: false,
	strict: "ignore",
});

const renderImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
	const token = tokens[idx];
	const src = token.attrGet("src");
	if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//")) {
		token.attrSet("src", pathToFileURL(path.resolve(env.mdDir, src)).href);
	}
	return renderImage(tokens, idx, options, env, self);
};

const escapeHtml = (value) =>
	value.replace(/[&<>"']/g, (char) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	})[char]);

const collectMarkdownFiles = (dir) => {
	const files = [];
	const walk = (current) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
			} else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
				files.push(fullPath);
			}
		}
	};
	walk(dir);
	return files.sort();
};

const loadExtraStyles = (spec, baseDir) => {
	const files = Array.isArray(spec) ? spec : spec ? [spec] : [];
	return files
		.map((file) => {
			const css = fs.readFileSync(path.resolve(baseDir, file), "utf8");
			return `<style>\n${css}\n</style>`;
		})
		.join("\n");
};

const buildDocument = (raw, mdDir, fallbackTitle) => {
	const { data, content } = matter(raw);
	const body = md.render(content, { mdDir });
	const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : fallbackTitle;
	const extraCss = loadExtraStyles(data.css, mdDir);

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${katexCss}
</style>
<style>
${baseCss}
</style>
${extraCss}
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;

	const pdfOptions = {
		format: "A4",
		printBackground: true,
		displayHeaderFooter: true,
		headerTemplate: "<div></div>",
		footerTemplate:
			'<div style="width:100%;padding:0 18mm;font-size:9px;color:#8b949e;text-align:right;">' +
			'<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
		margin: { top: "18mm", right: "18mm", bottom: "20mm", left: "18mm" },
		...(data.pdf && typeof data.pdf === "object" ? data.pdf : {}),
	};

	return { html, pdfOptions };
};

const renderFile = async (browser, srcFile, destFile, tmpDir, index) => {
	const mdDir = path.dirname(srcFile);
	const fallbackTitle = path.basename(srcFile, path.extname(srcFile));
	const { html, pdfOptions } = buildDocument(fs.readFileSync(srcFile, "utf8"), mdDir, fallbackTitle);

	const tmpHtml = path.join(tmpDir, `document-${index}.html`);
	fs.writeFileSync(tmpHtml, html);

	const page = await browser.newPage();
	try {
		await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: "load" });
		await page.emulateMedia({ media: "print" });
		await page.evaluate(() => document.fonts.ready);
		const pdf = await page.pdf(pdfOptions);

		fs.mkdirSync(path.dirname(destFile), { recursive: true });
		fs.writeFileSync(destFile, pdf);
	} finally {
		await page.close();
		fs.rmSync(tmpHtml, { force: true });
	}
};

const runPool = async (items, limit, worker) => {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			await worker(items[index], index);
		}
	});
	await Promise.all(runners);
};

const main = async () => {
	if (!fs.existsSync(docPath)) {
		console.error("No 'doc' folder found!");
		process.exitCode = 1;
		return;
	}

	fs.rmSync(buildPath, { recursive: true, force: true });
	fs.mkdirSync(buildPath, { recursive: true });

	const files = collectMarkdownFiles(docPath);
	if (files.length === 0) {
		console.warn("No markdown files found in 'doc'.");
		return;
	}

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "md-to-pdf-"));
	const browser = await chromium.launch({ channel: "chromium" });
	let failures = 0;

	try {
		await runPool(files, concurrency, async (srcFile, index) => {
			const relative = path.relative(docPath, srcFile);
			const destFile = path.join(buildPath, relative.replace(/\.md$/i, ".pdf"));

			try {
				await renderFile(browser, srcFile, destFile, tmpDir, index);
				console.log(`  ${relative} -> ${path.relative(rootPath, destFile)}`);
			} catch (error) {
				failures++;
				console.error(`  FAILED ${relative}: ${error.message}`);
			}
		});
	} finally {
		await browser.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}

	if (failures > 0) {
		process.exitCode = 1;
	}
};

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
