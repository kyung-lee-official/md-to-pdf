let fs = require("fs");
let { mdToPdf } = require('md-to-pdf');
const path = require("path");

const docPath = "./doc";
const buildPath = "./build";
const buildAbsPath = path.resolve(buildPath);

fs.rmSync(buildAbsPath, { recursive: true, force: true });
fs.mkdirSync(buildPath);

if (!fs.existsSync(docPath)) {
	console.error("No 'doc' folder found!");
} else {
	const srcAbsPath = path.resolve(docPath);
	const walk = (preDocPath, preTargetPath) => {
		const list = fs.readdirSync(preDocPath);
		list.forEach(obj => {
			const objStats = fs.statSync(path.resolve(preDocPath, obj));
			if (objStats.isDirectory()) {
				fs.mkdirSync(path.resolve(preTargetPath, obj), { recursive: true });
				walk(path.resolve(preDocPath, obj), path.resolve(preTargetPath, obj));
			} else {
				if (path.extname(obj) === ".md") {
					(async () => {
						const pdf = await mdToPdf({ path: path.resolve(preDocPath, obj) }).catch(console.error);
						if (pdf) {
							fs.writeFileSync(`${path.resolve(preTargetPath, path.parse(obj).name)}.pdf`, pdf.content);
						}
					})();
				}
			}
		});
	};
	walk(srcAbsPath, buildAbsPath);
}
