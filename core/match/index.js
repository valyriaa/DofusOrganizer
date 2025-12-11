const bindings = require('bindings');
const Jimp = require('jimp');

const nonRectHints = [
    // "accept_group",
    // "on_group"
];

const mod = bindings('matcher');

function matTemplatesFromPNGs(arr, currentFrameWidth, currentFrameHeight) {
    return arr.map(t => {
        const scaleX = currentFrameWidth / t.originalWidth;
        const scaleY = currentFrameHeight / t.originalHeight;
        const scale = Math.min(scaleX, scaleY);

        const jimg = new Jimp.Jimp({ data: t.png.data, width: t.png.width, height: t.png.height });

        jimg.resize({ w: Math.round(t.png.width * scale), h: Math.round(t.png.height * scale) });

        const resizedBuf = Buffer.from(jimg.bitmap.data);

        const tpl = {
            id: t.id,
            buf: resizedBuf,
            w: jimg.bitmap.width,
            h: jimg.bitmap.height
        };

        if (t.rect && !nonRectHints.includes(t.id)) {
            tpl.rect = {
                x: Math.round(t.rect.x * scale),
                y: Math.round(t.rect.y * scale),
                width: jimg.bitmap.width,
                height: jimg.bitmap.height
            };
        }
        return tpl;
    });
}

function loadTemplates(templates, options = {}) {
    if (!options.width || !options.height) {
        throw new Error('frame width and height must be provided to loadTemplates');
    }
    const matTemplates = matTemplatesFromPNGs(templates, options.width, options.height);
    const opts = {
        templates: matTemplates,
        margin: options.margin ?? 50
    };
    return mod.loadTemplates(opts);
}

function findTemplates(framePng, options = {}) {
    const args = {
        frameBuffer: Buffer.from(framePng.data),
        frameWidth: framePng.width,
        frameHeight: framePng.height,
        method: options.method,
        channelWeights: options.channelWeights ?? [1, 1, 1]
    };

    return new Promise((resolve) => {
        mod.findTemplatesAsync(args, (err, resultsArray) => {
            if (err) {
                console.error(err);
                return resolve([]);
            }
            resolve(resultsArray);
        });
    });
}

module.exports = { loadTemplates, findTemplates };
