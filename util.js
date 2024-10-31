function configContext(device, canvas) {
    let context = canvas.getContext('webgpu');

    const canvasConfig = {
        device: device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        usage:
            GPUTextureUsage.RENDER_ATTACHMENT,
    };

    context.configure(canvasConfig);
    return context;
}

function createOutputTexture(device, width, height, format) {
    const textureDesc = {
        label: 'output storage texture',
        size: {width: width, height: height},
        format: format,
        usage: GPUTextureUsage.COPY_SRC |
               GPUTextureUsage.STORAGE_BINDING |
               GPUTextureUsage.TEXTURE_BINDING,
    };

    let storageTexture = device.createTexture(textureDesc);
    return storageTexture;
}

function reinterpretUint32AsFloat(uint32)
{
    const buffer = new ArrayBuffer(4);
    const uint32View = new Uint32Array(buffer);
    const float32View = new Float32Array(buffer);

    uint32View[0] = uint32;
    return float32View[0];
}

function parsePrintfFormat(formatString)
{
    const formatSpecifiers = [];
    const regex = /%([-+ #0]*)(\d*)(\.\d+)?([diufFeEgGxXosc])/g;
    let lastIndex = 0;

    let match;
    while ((match = regex.exec(formatString)) !== null)
    {
        const [fullMatch, flags, width, precision, type] = match;
        const literalText = formatString.slice(lastIndex, match.index);

        // Add literal text before the match as a token, if any
        if (literalText)
        {
          formatSpecifiers.push({ type: 'text', value: literalText });
        }

        // Add the format specifier as a token
        formatSpecifiers.push({
          type: 'specifier',
          flags: flags || '',
          width: width || null,
          precision: precision ? precision.slice(1) : null, // remove leading '.'
          specifierType: type
        });

        lastIndex = regex.lastIndex;
    }

    // Add any remaining literal text after the last match
    if (lastIndex < formatString.length)
    {
        formatSpecifiers.push({ type: 'text', value: formatString.slice(lastIndex) });
    }

    return formatSpecifiers;
}

function formatPrintfString(parsedTokens, data)
{
    let result = '';
    let dataIndex = 0;

    parsedTokens.forEach(token => {
        if (token.type === 'text')
        {
            result += token.value;
        }
        else if (token.type === 'specifier')
        {
            const value = data[dataIndex++];
            result += formatSpecifier(value, token);
        }
    });

    return result;
}

// Helper function to format each specifier
function formatSpecifier(value, { flags, width, precision, specifierType })
{
    let formattedValue;

    switch (specifierType)
    {
    case 'd':
    case 'i': // Integer (decimal)
        formattedValue = parseInt(value).toString();
        break;
    case 'u': // Unsigned integer
        formattedValue = Math.abs(parseInt(value)).toString();
        break;
    case 'o': // Octal
        formattedValue = Math.abs(parseInt(value)).toString(8);
        break;
    case 'x': // Hexadecimal (lowercase)
        formattedValue = Math.abs(parseInt(value)).toString(16);
        break;
    case 'X': // Hexadecimal (uppercase)
        formattedValue = Math.abs(parseInt(value)).toString(16).toUpperCase();
        break;
    case 'f':
    case 'F': // Floating-point
        formattedValue = parseFloat(value).toFixed(precision || 6);
        break;
    case 'e': // Scientific notation (lowercase)
        formattedValue = parseFloat(value).toExponential(precision || 6);
        break;
    case 'E': // Scientific notation (uppercase)
        formattedValue = parseFloat(value).toExponential(precision || 6).toUpperCase();
        break;
    case 'g':
    case 'G': // Shortest representation of floating-point
        formattedValue = parseFloat(value).toPrecision(precision || 6);
        break;
    case 'c': // Character
        formattedValue = String.fromCharCode(parseInt(value));
        break;
    case 's': // String
        formattedValue = String(value);
        if (precision)
        {
            formattedValue = formattedValue.slice(0, precision);
        }
        break;
    case '%': // Literal '%'
        return '%';
    default:
        throw new Error(`Unsupported specifier: ${specifierType}`);
    }

    // Handle width and flags (like zero-padding, space, left alignment, sign)
    if (width)
    {
        const paddingChar = flags.includes('0') && !flags.includes('-') ? '0' : ' ';
        const isLeftAligned = flags.includes('-');
        const needsSign = flags.includes('+') && parseFloat(value) >= 0;
        const needsSpace = flags.includes(' ') && !needsSign && parseFloat(value) >= 0;

        if (needsSign)
        {
            formattedValue = '+' + formattedValue;
        }
        else if (needsSpace)
        {
            formattedValue = ' ' + formattedValue;
        }

        if (formattedValue.length < width)
        {
            const padding = paddingChar.repeat(width - formattedValue.length);
            formattedValue = isLeftAligned ? formattedValue + padding : padding + formattedValue;
        }
    }

    return formattedValue;
}

// // Example usage
// const formatString = "Int: %d, Unsigned: %u, Hex: %X, Float: %8.2f, Sci: %e, Char: %c, Str: %.5s!";
// const parsedTokens = parsePrintfFormat(formatString);
// const data = [42, -42, 255, 3.14159, 0.00001234, 65, "Hello, world"];
// const output = formatPrintfString(parsedTokens, data);
// console.log(output);
