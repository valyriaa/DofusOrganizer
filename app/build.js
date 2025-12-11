const esbuild = require("esbuild");
const path = require("path");
const fs = require('fs');
const archiver = require('archiver');
const packager = require('electron-packager');
const getOpenCVPath = require('../core/match/ocv');

const build_path = path.join(__dirname, "build");
const core_path = path.join(__dirname, "..", "core");
const matcher_node_path = path.join(core_path, "match", "build", "Release", "matcher.node");
const watcher_node_path = path.join(core_path, "native", "build", "Release", "process_watcher.node");
const inprocess_dll_path = path.join(core_path, "native", "in-process", "build", "in-process.dll");
const frida_node_path = path.join(core_path, "node_modules", "frida", "build", "frida_binding.node");

const targetArch = process.argv.slice(2)[0] ?? require('os').arch();

if (!fs.existsSync(build_path)) {
    fs.mkdirSync(build_path);
}

const bundleApp = [
    esbuild.build({
        external: ["electron", "module", "*.node", "*.dll"],
        entryPoints: [path.join(__dirname, "main.js")],
        bundle: true,
        platform: "node",
        minify: true,
        outfile: path.join(build_path, "main.js"),
    }).catch(err => {
        console.error(err);
        process.exit()
    }),
    esbuild.build({
        external: ["electron"],
        entryPoints: [path.join(__dirname, "preload.js")],
        bundle: true,
        platform: "node",
        minify: true,
        outfile: path.join(build_path, "preload.js"),
    }).catch(err => {
        console.error(err);
        process.exit()
    }),
];

Promise
    .all(bundleApp)
    .then(async () => {

        fs.cpSync(path.join(__dirname, "package.json"), path.join(build_path, "package.json"))
        fs.cpSync(path.join(__dirname, "assets"), path.join(build_path, "assets"), { recursive: true })

        const [releasePath] = await packager({
            dir: build_path,
            name: 'dofus-organizer',
            out: path.join(__dirname, 'release'),
            arch: targetArch,
            platform: 'win32',
            asar: true,
            overwrite: true,
            prune: true,
            icon: path.join(__dirname, 'assets', 'icon.ico'),
        });

        const native_build_path = path.join(releasePath, "resources", "app.asar.unpacked");
        const openCvDll = getOpenCVPath()[1];

        if (!fs.existsSync(native_build_path)) {
            fs.mkdirSync(native_build_path);
        }

        fs.copyFileSync(matcher_node_path, path.join(native_build_path, "matcher.node"));
        fs.copyFileSync(watcher_node_path, path.join(native_build_path, "process_watcher.node"));
        fs.copyFileSync(inprocess_dll_path, path.join(native_build_path, "in-process.dll"));
        fs.copyFileSync(openCvDll, path.join(native_build_path, path.basename(openCvDll)));
        fs.copyFileSync(frida_node_path, path.join(native_build_path, path.basename(frida_node_path)));
        
        fs.cpSync(path.join(__dirname, "package.json"), path.join(releasePath, "package.json"))

        const zipName = path.join(__dirname, 'release', `dofus-organizer-${targetArch}.zip`);
        const output = fs.createWriteStream(zipName);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            console.log(`ZIP created: ${zipName} (${archive.pointer()} bytes)`);
        });

        archive.on('error', err => { throw err; });

        archive.pipe(output);
        archive.directory(releasePath, false);

        await archive.finalize();

        console.log('Build complete:', releasePath);
    })
    .then(() => {
        console.log('app build ready.')
    })
    .catch(err => {
        console.log(err)
    })
