const fs = require("fs");
const path = require("path");
const { exec, spawnSync } = require("child_process");

const MIN_HOOK_RELEASE = process.env.MIN_HOOK_RELEASES ?? `https://github.com/TsudaKageyu/minhook/releases/download/`;
const arch = process.env.target_arch?.trim() ?? require('os').arch();

function runWhereRecursive(root) {
    return new Promise((resolve) => {
        const cmd = `where /r "${root}" ` + (arch == "x64" ? "vcvars64.bat" : "vcvars32.bat");

        exec(cmd, { windowsHide: true }, (err, stdout) => {
            if (err || !stdout.trim()) return resolve([]);
            resolve(
                stdout
                    .split(/\r?\n/)
                    .map(x => x.trim())
                    .filter(x => x.length > 0)
            );
        });
    });
}

async function findVcvars64() {
    const roots = [
        "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022",
        "C:\\Program Files\\Microsoft Visual Studio"
    ];

    let all = [];

    for (const dir of roots) {
        const found = await runWhereRecursive(dir);
        all = all.concat(found);
    }

    return {
        found: all,
        selected: all.length > 0 ? all[0] : null
    };
}

async function setupMinHook() {
    if (arch != 'x64' && arch != "ia32") {
        throw new Error(`unsupported minhook arch (${arch}).`);
    }

    const ar = arch == "ia32" ? "x86" : arch;
    if (process.env.MIN_HOOK_PATH && fs.existsSync(process.env.MIN_HOOK_PATH)) {
        const minhookInclude = path.join(process.env.MIN_HOOK_PATH, "include");
        const minhookLib = path.join(process.env.MIN_HOOK_PATH, "lib", `libMinHook.${ar}.lib`);
        return [minhookInclude, minhookLib]
    }

    const v = process.env.MIN_HOOK_VERSION ?? "1.3.4";
    const url = `${MIN_HOOK_RELEASE}/v${v}/MinHook_${v.replaceAll('.', '')}_lib.zip`;
    const destPath = path.join(__dirname, "in-process", "minHook");
    const zipPath = path.join(destPath, "tmp.zip");

    if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath);
    }

    spawnSync("powershell", ["-Command", `Invoke-WebRequest -Uri ${url} -OutFile ${zipPath}`], { stdio: "inherit" });

    spawnSync("powershell", [
        "-Command",
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${destPath}' -Force`
    ], { stdio: "inherit" });

    try { fs.unlinkSync(zipPath); } catch { }

    return [
        path.join(destPath, "include"),
        path.join(destPath, "lib", `libMinHook.${ar}.lib`)
    ];
}

async function buildNativeDLL() {
    const { selected } = await findVcvars64();
    if (!selected) {
        throw new Error("vcvars64.bat not found on this machine");
    }

    const nativeDir = path.join(__dirname, "in-process");
    const source = path.join(nativeDir, "in-process.cpp");
    const output = path.join(nativeDir, "build", "in-process.dll");

    if (!fs.existsSync(source)) {
        throw new Error(`Source not found: ${source}`);
    }

    if (!fs.existsSync(path.dirname(output))) {
        fs.mkdirSync(path.dirname(output), { recursive: true })
    }

    const [minhookInclude, minhookLib] = await setupMinHook();

    const cmd = [
        `call "${selected}"`,
        `&&`,
        `cl.exe /LD "${source}" /Fe:"${output}" /EHsc /I "${minhookInclude}"`,
        `/link`,
        `"${minhookLib}"`,
        `d3d11.lib dxgi.lib user32.lib gdi32.lib Dbghelp.lib`
    ].join(' ');

    return new Promise((resolve, reject) => {
        exec(cmd, { shell: "cmd.exe", cwd: nativeDir, windowsHide: false, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                console.log(stdout);
                return reject(new Error(`[BUILD] Compile failed: ${err.message}`));
            }
            if (!fs.existsSync(output)) {
                return reject(new Error("[BUILD] Compile finished but DLL not found"));
            }
            resolve(output);
        });
    });
}

module.exports = buildNativeDLL;

if (require.main == module) {
    buildNativeDLL();
}