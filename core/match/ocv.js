const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const OPENCV_VERSION = process.env.OPENCV_VERSION ?? "4.11.0";
const OPEN_CV_RELEASES = process.env.OPENCV_RELEASES ?? "https://github.com/opencv/opencv/releases/download";

function getDllPath(basePath) {
    return path.join(basePath, "build", "x64", "vc16", "bin", `opencv_world${OPENCV_VERSION.replaceAll('.', '')}.dll`);
}

function getOpenCVPath() {

    if (process.env.OPENCV_DIR && fs.existsSync(process.env.OPENCV_DIR)) {
        return [
            process.env.OPENCV_DIR,
            getDllPath(process.env.OPENCV_DIR)
        ];
    }

    const url = `${OPEN_CV_RELEASES}/${OPENCV_VERSION}/opencv-${OPENCV_VERSION}-windows.exe`;
    const localDir = path.resolve(__dirname, "opencv");
    const archivePath = path.join(localDir, `opencv-${OPENCV_VERSION}.exe`);
    const extractedDir = path.join(localDir, `opencv`);
    const dllPath = getDllPath(extractedDir);
    const dllDevPath = path.join(__dirname, "build", "Release", path.basename(dllPath));

    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });


    if (!fs.existsSync(archivePath)) {
        spawnSync("powershell", ["-Command", `Invoke-WebRequest -Uri ${url} -OutFile ${archivePath}`], { stdio: "inherit" });
    }

    if (!fs.existsSync(extractedDir)) {
        execFileSync(archivePath, ["-y", "-gm2", `-InstallPath="${extractedDir}"`]);
    }

    if (!fs.existsSync(path.dirname(dllDevPath))) {
        fs.mkdirSync(path.dirname(dllDevPath));
    }

    fs.cpSync(dllPath, dllDevPath);

    return [extractedDir, dllPath];
}

module.exports = getOpenCVPath;