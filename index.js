const Jimp = require('jimp');
const prompts = require('prompts');
const gifFrames = require('gif-frames');
const { emptyDirSync, ensureDirSync, writeFileSync } = require('fs-extra');
const { GifCodec, GifFrame } = require('gifwrap');
const got = require('got');

const OUT_PATH = process.env.OUT_PATH || './out';
const DATA_PATH = process.env.DATA_PATH || './.data';
const SIZE = 64;
const DIMENSIONS_W_H_REGEX = /^[0-9]+[,|x][0-9]+$/;
const DIMENSIONS_N_REGEX = /^[0-9]+$/;

function getHistory() {
    try {
        return require(`${DATA_PATH}/history.json`);
    } catch {
        return {};
    }
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
        type: 'text',
        name: 'dimensions',
        message: 'Grid dimensions (w,h or n):',
        initial: '1',
        validate: (value) => {
            return (DIMENSIONS_W_H_REGEX.test(value) || DIMENSIONS_N_REGEX.test(value)) || 'Please input valid dimensions'
        }
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
    {
        type: 'toggle',
        name: 'enableAdvancedFilters',
        message: 'Enable advanced filters?',
        initial: false,
        active: 'yes',
        inactive: 'no',
    }
];

const filterQuestions = [
    {
        type: 'multiselect',
        name: 'filters',
        message: 'Apply filters:',
        choices: [
            { title: 'Brightness', value: 'brightness' },
            { title: 'Contrast', value: 'contrast' },
            { title: 'Invert', value: 'invert' },
            { title: 'Grayscale', value: 'greyscale' },
            { title: 'Sepia', value: 'sepia' },
            { title: 'Normalize', value: 'normalize' },
            { title: 'Posterize', value: 'posterize' },
            { title: 'Flip', value: 'flip' },
            { title: 'Rotate', value: 'rotate' },
            { title: 'Fade', value: 'fade' },
            { title: 'Opacity', value: 'opacity' },
        ],
    }
];

// Filter Defaults
const FD = {
    BAC_MIN: -100,
    BAC_MAX: 100,
    OP_MIN: 0,
    OP_MAX: 100,
    POS_MIN: 1,
    POS_MAX: 255,
}

const constructFilterPrompts = (filters) => {
    return filters.reduce((acc, filter) => {
        switch (filter) {
            case 'brightness':
            case 'contrast':
                acc.push({
                    type: 'number',
                    name: filter,
                    message: `Adjust ${filter} level: (${FD.BAC_MIN} - ${FD.BAC_MAX})`,
                    initial: 0,
                    validate: value => (value >= FD.BAC_MIN && value <= FD.BAC_MAX) || `Number must be between ${FD.BAC_MIN} and ${FD.BAC_MAX}`
                });
                break;
            case 'opacity':
                acc.push({
                    type: 'number',
                    name: filter,
                    message: `Adjust opacity: (${FD.OP_MIN} - ${FD.OP_MAX})`,
                    initial: 1,
                    validate: value => (value >= FD.OP_MIN && value <= FD.OP_MAX) || `Number must be between ${FD.OP_MIN} and ${FD.OP_MAX}`
                });
                break;
            case 'posterize':
                acc.push({
                    type: 'number',
                    name: filter,
                    message: `Posterization levels: (${FD.POS_MIN} - ${FD.POS_MAX})`,
                    initial: 8,
                    validate: value => (value >= FD.POS_MIN && value <= FD.POS_MAX) || `Number must be between ${FD.POS_MIN} and ${FD.POS_MAX}`
                });
                break;
            case 'rotate':
                acc.push({
                    type: 'number',
                    name: filter,
                    message: 'Rotate image: (deg)',
                    initial: 0,
                });
                break;
            case 'flip':
                acc.push({
                    type: 'select',
                    name: filter,
                    message: 'Flip image:',
                    choices: [
                        { title: 'Vertical', value: 'vertical' },
                        { title: 'Horizontal', value: 'horizontal' },
                        { title: 'Both', value: 'both' },
                    ]
                });
                break;
            default:
                return acc;
        }

        return acc;
    }, []);
}

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

async function init(args) {
    let { image, dimensions, name, mode, filters, filterValues } = args;

    // Clean up output directory
    emptyDirSync(`${OUT_PATH}/${name}`);

    // Write new image to history for quick access to last image when tweaking
    writeFileSync(`${DATA_PATH}/history.json`, JSON.stringify({ emoji: image }));

    let widthParts, heightParts;

    if (image && dimensions && mode) {
        // When dragging in an image from the OS to the terminal, it will wrap it in single quote
        // Strip them for a more seamless user experience
        if (image.startsWith("'") && image.endsWith("'")) {
            image = image.substr(1, image.length - 2);
        }
        const isUrl = /^http?s:\/\/[a-z.\/\-]*/.test(image);
        let ext = image.split('.').pop();

        if (DIMENSIONS_W_H_REGEX.test(dimensions)) {
            let parts = dimensions.split(',').map(Number);
            widthParts = parts[0];
            heightParts = parts[1];
        } else if (DIMENSIONS_N_REGEX.test(dimensions)) {
            widthParts = heightParts = Number(dimensions);
        } else {
            return console.error(`Invalid dimensions: '${dimensions}'`)
        }

        if (ext.toLowerCase() === 'gif') {
            let readable = isUrl ? await got(image).buffer() : image;
            let frames = await gifFrames({ url: readable, frames: 'all', outputType: 'png', cumulative: false });
            const gifs = [];

            for (let i = 0; i < widthParts * heightParts; i++) {
                gifs.push([]);
            }

            for (let i = 0; i < frames.length; i++) {
                let jimpFrame = await Jimp.read(frames[i].getImage());

                applyFilters(jimpFrame, filters, filterValues);

                let frameParts = splitFrame(jimpFrame, { widthParts, heightParts }, ext, mode);

                for (let j = 0; j < frameParts.length; j++) {
                    gifs[j].push({ frame: frameParts[j], frameInfo: frames[i].frameInfo })
                }
            }

            let codec = new GifCodec();

            for (let i = 0; i < gifs.length; i++) {
                codec.encodeGif(gifs[i].map(({ frame, frameInfo }) => {
                    let thisFrame = new GifFrame(SIZE, SIZE, 0, { delayCentisecs: frameInfo.delay })
                    thisFrame.bitmap.data = frame.bitmap.data;
                    return thisFrame;
                }), { colorScope: 2 }).then(gif => {
                    writeFileSync(`${OUT_PATH}/${name}/${name}${gifs.length > 1 ? '-' + (i + 1) : ''}.gif`, gif.buffer)
                });

                // Debug individual frames
                // for (let j = 0; j < gifs[i].length; j++) {
                //     gifs[i][j].write(`${OUT_PATH}/large${name}${i + 1}-${j}.png`)
                // }
            }
        } else {
            Jimp.read(image).then(image => {
                applyFilters(image, filters, filterValues)

                const parts = splitFrame(image, { widthParts, heightParts }, ext, mode);
                parts.forEach((image, count) => {
                    image.write(`${OUT_PATH}/${name}/${name}${parts.length > 1 ? '-' + (count + 1) : ''}.${ext}`);
                });
            }).catch(console.log);
        }
    } else {
        console.log('Exited...')
    }
}

// Apply Filters to Jimp image with their corresponding values
const applyFilters = (image, filters, filterValues) => {
    if (filters && filters.length) {
        filters.forEach(filter => {
            switch (filter) {
                case 'flip':
                    if (filterValues[filter] === 'horizontal') {
                        return image[filter](true, false);
                    } else if (filterValues[filter] === 'vertical') {
                        return image[filter](false, true);
                    } else if (filterValues[filter] === 'both') {
                        return image[filter](true, true);
                    } else {
                        return;
                    }
                case 'brightness':
                case 'contrast':
                case 'opacity':
                case 'rotate':
                    // Number inputs need to be transformed to the appropriate range so divide by 100
                    return image[filter](filterValues[filter] / 100);
                case 'posterize':
                    // Posterization takes a simple whole number of levels
                    return image[filter](filterValues[filter]);
                default:
                    return image[filter]()
            }

        });
    }
}

// Returns an array of emoji-sized, Jimp modifyable images
function splitFrame(image, { widthParts, heightParts }, ext, mode) {
    let width = widthParts * SIZE;
    let height = heightParts * SIZE;

    // Debug original image after Jimp processing
    // image.write(`${OUT_PATH}/original.${ext}`)
    let resized = image[mode](width, height);
    let images = [];

    for (let y = 0; y < heightParts; y++) {
        for (let x = 0; x < widthParts; x++) {
            // Create a copy to modify and crop
            let cloned = resized.clone();

            cloned.crop(x * SIZE, y * SIZE, SIZE, SIZE);
            if (ext === 'gif') {
                // Was getting some weird 'colorspace limit' errors 🤷‍♂️
                cloned.posterize(15);
            }

            images.push(cloned);
        }
    }

    return images;
}

(async () => {
    ensureDirSync(DATA_PATH);

    // Get image settings & await user input
    const settings = await prompts(questions);

    if (!settings.image) return console.error('No image specified');

    // Get list of filters to apply
    const filters = settings.enableAdvancedFilters ? await prompts(filterQuestions) : {};
    // Make prompts for filters that require additional input & await user input
    const filterPrompts = filters.filters && filters.filters.length ? constructFilterPrompts(filters.filters) : {};
    const filterValues = filterPrompts && filterPrompts.length ? await prompts(filterPrompts) : {};

    // Get name of file to save
    const name = await prompts(finalQuestions(settings.image));

    await init({ ...settings, ...filters, ...name, filterValues: filterValues });
})();
