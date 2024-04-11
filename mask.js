const Jimp = require('jimp');
const prompts = require('prompts');
const gifFrames = require('gif-frames');
const { emptyDirSync, ensureDirSync, writeFileSync, readdirSync } = require('fs-extra');
const { GifCodec, GifFrame } = require('gifwrap');
const got = require('got');

const OUT_PATH = process.env.OUT_PATH || './out';
const MASKS_PATH = process.env.MASKS_PATH || './masks';
const DATA_PATH = process.env.DATA_PATH || './.data';
const SIZE = 128;

function getHistory() {
    try {
        return require(`${DATA_PATH}/history.json`);
    } catch {
        return {};
    }
}

async function init(args) {
    let { image, name, mode } = args;

    // Clean up output directory
    emptyDirSync(`${OUT_PATH}/${name}`);

    // Write new image to history for quick access to last image when tweaking
    writeFileSync(`${DATA_PATH}/history.json`, JSON.stringify({ emoji: image }));

    const masks = readdirSync(`${MASKS_PATH}`).filter(item => !/(^|\/)\.[^/.]/g.test(item));

    if (!image) {
        console.log('Exited...')
    }

    for (const maskFile of masks) {
        // When dragging in an image from the OS to the terminal, it will wrap it in single quote
        // Strip them for a more seamless user experience
        if (image.startsWith("'") && image.endsWith("'")) {
            image = image.substr(1, image.length - 2);
        }
        const isUrl = /^http?s:\/\/[a-z.\/\-]*/.test(image);
        let ext = image.split('.').pop();
        const alphabet = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'exclamation', 'question', 'period', 'comma', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'open-parenthesis', 'close-parenthesis', 'open-bracket', 'close-bracket', 'colon', 'semi-colon', 'equals', 'quote', 'apostrophe', 'underscore', 'plus', 'minus', 'asterisk', 'slash', 'pipe', 'less-than', 'greater-than', 'at-sign', 'hash', 'dollar-sign', 'modulo', 'caret', 'ampersand'];
        const maskName = alphabet[(parseInt(maskFile.split('.')[0]) - 1)] || maskName;
        const mask = await Jimp.read(`${MASKS_PATH}/${maskFile}`);

        if (ext.toLowerCase() === 'gif') {
            let readable = isUrl ? await got(image).buffer() : image;
            let frames = await gifFrames({ url: readable, frames: 'all', outputType: 'png', cumulative: false });
            const gif = [];

            for (let i = 0; i < frames.length; i++) {
                let jimpFrame = await Jimp.read(frames[i].getImage());
                let frame = getImageWithMask(jimpFrame, mask, ext, mode);
                gif.push({ frame, frameInfo: frames[i].frameInfo })
            }

            let codec = new GifCodec();
            codec.encodeGif(gif.map(({ frame, frameInfo }) => {
                let thisFrame = new GifFrame(SIZE, SIZE, 0, { delayCentisecs: frameInfo.delay })
                thisFrame.bitmap.data = frame.bitmap.data;
                return thisFrame;
            }), { colorScope: 2 }).then(gif => {
                writeFileSync(`${OUT_PATH}/${name}/${name}-${maskName}.gif`, gif.buffer)
            });

            // Debug individual frames
            // for (let j = 0; j < gifs[i].length; j++) {
            //     gifs[i][j].write(`${OUT_PATH}/large${name}${i + 1}-${j}.png`)
            // }
        } else {
            Jimp.read(image).then(image => {
                getImageWithMask(image, mask, ext, mode).write(`${OUT_PATH}/${name}/${name}.${ext}`);
            }).catch(console.log);
        }
    }
}

// Returns an array of emoji-sized, Jimp modifyable images
function getImageWithMask(image, mask, ext, mode) {
    let width = SIZE;
    let height = SIZE;
    // Debug original image after Jimp processing
    // image.write(`${OUT_PATH}/original.${ext}`)
    let resized = image[mode](width, height);
    // Create a copy to modify and crop
    let cloned = resized.clone();
    cloned.crop(0, 0, SIZE, SIZE);
    cloned.mask(mask[mode](width, height), 0, 0);
    if (ext === 'gif') {
        // Was getting some weird 'colorspace limit' errors 🤷‍♂️
        cloned.posterize(15);
    }
    return cloned;
}

const questions = [
    {
        type: 'text',
        name: 'image',
        message: 'Image path or url:',
        initial: getHistory().emoji || undefined,
        validate: (value) => /\.(png|jpe?g|gif|bmp)'?$/.test(value.trim()) || 'Supported image formats are: .png, .jpg, .gif & .bmp',
        format: value => value.trim()
    },
    {
        type: 'select',
        name: 'mode',
        message: 'Resize mode:',
        choices: [{
            title: 'Stretch',
            value: 'resize',
        }, {
            title: 'Cover',
            value: 'cover',
        }, {
            title: 'Contain',
            value: 'contain',
        }]
    },
]

const finalQuestions = (image) => {
    // Default image name
    const imageName = image
        .split('/')
        .pop()
        .split('.')
        .shift()
        .replace(/ /g, '-')
        .replace(/[^a-zA-Z0-9-]*/g, '') || 'emoji';

    return [
        {
            type: 'text',
            name: 'name',
            message: 'Name:',
            initial: imageName
        }
    ]
}

(async () => {
    ensureDirSync(DATA_PATH);

    // Get image settings & await user input
    const settings = await prompts(questions);

    if (!settings.image) return console.error('No image specified');

    // Get name of file to save
    const name = await prompts(finalQuestions(settings.image));

    await init({ ...settings, ...name });
})();
