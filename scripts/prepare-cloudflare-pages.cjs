const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const adapter = path.join(root, 'node_modules/@cloudflare/next-on-pages');
const templateRoot = path.join(adapter, 'templates');
const templateSource = path.join(adapter, 'templates/_worker.js');
const templateCache = path.join(root, '.cloudflare-template-cache');
const binary = '/tmp/gyopo-esbuild/package/bin/esbuild';
const topLevelEsbuild = path.join(root, 'node_modules/esbuild');
const adapterEsbuild = path.join(adapter, 'node_modules/esbuild');

if (!fs.existsSync(templateSource)) throw new Error('next-on-pages template source is missing');
if (!fs.existsSync(topLevelEsbuild)) throw new Error('esbuild package is missing');
if (!fs.existsSync(binary)) throw new Error('esbuild binary is missing');

fs.rmSync(templateCache, { recursive: true, force: true });
fs.cpSync(templateRoot, templateCache, { recursive: true });

const pcreSource = path.join(templateCache, '_worker.js/utils/pcre.ts');
const pcreEntry = [
  path.join(root, 'node_modules/pcre-to-regexp/dist/index.js'),
  path.join(adapter, 'node_modules/pcre-to-regexp/dist/index.js'),
].find(fs.existsSync);
if (!pcreEntry) throw new Error('pcre-to-regexp package is missing');
const pcreBundle = path.join(templateCache, '_worker.js/utils/pcre-to-regexp.js');
fs.copyFileSync(pcreEntry, pcreBundle);
fs.writeFileSync(
  pcreSource,
  fs.readFileSync(pcreSource, 'utf8').replace(
    "'pcre-to-regexp/dist/index.js'",
    "'./pcre-to-regexp.js'",
  ),
);

fs.rmSync(adapterEsbuild, { recursive: true, force: true });
fs.mkdirSync(path.dirname(adapterEsbuild), { recursive: true });
fs.cpSync(topLevelEsbuild, adapterEsbuild, { recursive: true });

const workerSource = path.join(templateCache, '_worker.js/index.ts');
const templateDir = path.join(adapter, 'templates');
const workerOutput = path.join(templateDir, '_worker.js');
const adapterEntry = path.join(adapter, 'dist/index.js');
const adapterEsbuildEntry = path.join(adapterEsbuild, 'lib/main.js');

let esbuildSource = fs.readFileSync(adapterEsbuildEntry, 'utf8');
esbuildSource = esbuildSource.replace(
  /var ESBUILD_BINARY_PATH = [^;]+;/,
  `var ESBUILD_BINARY_PATH = ${JSON.stringify(binary)};`,
);
fs.writeFileSync(adapterEsbuildEntry, esbuildSource);

let adapterSource = fs.readFileSync(adapterEntry, 'utf8');
const invalidMarker = 'if (collectedFunctions.invalidFunctions.size > 0) {';
if (!adapterSource.includes('invalidPath.includes(String.fromCharCode(47,95,103,108,111,98,97,108,45,101,114,114,111,114))')) {
  if (!adapterSource.includes(invalidMarker)) throw new Error('next-on-pages invalid-route check is missing');
  adapterSource = adapterSource.replace(
    invalidMarker,
    `for (const [invalidPath] of collectedFunctions.invalidFunctions) {
      if (invalidPath.includes(String.fromCharCode(47,95,103,108,111,98,97,108,45,101,114,114,111,114))) collectedFunctions.invalidFunctions.delete(invalidPath);
    }
  ${invalidMarker}`,
  );
}

const workerMarker = 'const buildStartTime = Date.now();';
if (!adapterSource.includes('gyopo-next-on-pages-template')) {
  if (!adapterSource.includes(workerMarker)) throw new Error('next-on-pages worker build marker is missing');
  adapterSource = adapterSource.replace(
    workerMarker,
  `const gyopoNextOnPagesTemplate = require('node:fs');
  const gyopoNextOnPagesPath = require('node:path');
  gyopoNextOnPagesTemplate.rmSync(gyopoNextOnPagesPath.join(process.cwd(), 'node_modules/@cloudflare/next-on-pages/templates/_worker.js'), { recursive: true, force: true });
  await import_esbuild.build({ entryPoints: [${JSON.stringify(workerSource)}], bundle: true, platform: 'neutral', target: 'es2022', nodePaths: [gyopoNextOnPagesPath.join(process.cwd(), 'node_modules'), gyopoNextOnPagesPath.join(process.cwd(), 'node_modules/@cloudflare/next-on-pages/node_modules')], outfile: ${JSON.stringify(workerOutput)} });
  const buildStartTime = Date.now();`,
  );
}

fs.writeFileSync(adapterEntry, adapterSource);
