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
        size: { width: width, height: height },
        format: format,
        usage: GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.TEXTURE_BINDING,
    };

    let storageTexture = device.createTexture(textureDesc);
    return storageTexture;
}

function reinterpretUint32AsFloat(uint32) {
    const buffer = new ArrayBuffer(4);
    const uint32View = new Uint32Array(buffer);
    const float32View = new Float32Array(buffer);

    uint32View[0] = uint32;
    return float32View[0];
}


function parseResourceCommand(command) {
    const match = command.match(/(\w+)\((.*)\)/);
    if (match) {
        const funcName = match[1];

        // TODO: This isn't a very robust parser.. any commas in the url will break it.
        const args = match[2].split(',').map(arg => arg.trim());

        if (funcName === "ZEROS") {
            return { type: "ZEROS", size: args.map(Number) };
        }
        else if (funcName === "URL") {
            // remove the quotes
            const validURLMatch = args[0].match(/"(.*)"/)
            if (!validURLMatch) {
                throw new Error(`Invalid URL: ${url}`);
            }

            return { type: "URL", url: validURLMatch[1] };
        }
        else if (funcName === "RAND") {
            return { type: "RAND", size: args.map(Number) };
        };

    }
    else {
        throw new Error(`Invalid command: ${command}`);
    }
}

function parseResourceCommands(userSource) {
    // Now we'll handle some special comments that the user can provide to initialize their resources.
    //
    // Here are some patterns we support:
    // 1. //! @outputBuffer: ZEROS(512, 512)   ==> Initialize "outputBuffer" with zeros of the provided size.
    // 2. //! @myBuffer: URL("https://example.com/image.png")   ==> Initialize "myBuffer" with image from URL.
    // 3. //! @noiseBuffer: RAND(1000)   ==> Initialize "myBuffer" with uniform random floats between 0 and 1.
    //

    const resourceCommands = [];
    const lines = userSource.split('\n');
    for (let line of lines) {
        const match = line.match(/\/\/!\s+@(\w+):\s*(.*)/);
        if (match) {
            const resourceName = match[1];
            const command = match[2];
            const parsedCommand = parseResourceCommand(command);
            resourceCommands.push({ resourceName, parsedCommand });
        }
    }

    return resourceCommands;
}

function parseCallCommands(userSource) {
    // Look for commands of the form:
    //
    // 1. //! CALL(fn-name, SIZE_OF(<resource-name>)) ==> Dispatch a compute pass with the given 
    //                                                    function name and using the resource size
    //                                                    to determine the work-group size.
    // 2. //! CALL(fn-name, 512, 512) ==> Dispatch a compute pass with the given function name and
    //                                    the provided work-group size.
    //

    const callCommands = [];
    const lines = userSource.split('\n');
    for (let line of lines) {
        const match = line.match(/\/\/!\s+CALL\((\w+),\s*(.*)\)/);
        if (match) {
            const fnName = match[1];
            const args = match[2].split(',').map(arg => arg.trim());

            if (args[0].startsWith("SIZE_OF")) {
                callCommands.push({ type: "RESOURCE_BASED", fnName, resourceName: args[0].slice(8, -1) });
            }
            else {
                callCommands.push({ type: "FIXED_SIZE", fnName, size: args.map(Number) });
            }
        }
    }

    return callCommands;
}

function parsePrintfFormat(formatString) {
    const formatSpecifiers = [];
    const regex = /%([-+ #0]*)(\d*)(\.\d+)?([diufFeEgGxXosc])/g;
    let lastIndex = 0;

    let match;
    while ((match = regex.exec(formatString)) !== null) {
        const [fullMatch, flags, width, precision, type] = match;
        const literalText = formatString.slice(lastIndex, match.index);

        // Add literal text before the match as a token, if any
        if (literalText) {
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
    if (lastIndex < formatString.length) {
        formatSpecifiers.push({ type: 'text', value: formatString.slice(lastIndex) });
    }

    return formatSpecifiers;
}

function formatPrintfString(parsedTokens, data) {
    let result = '';
    let dataIndex = 0;

    parsedTokens.forEach(token => {
        if (token.type === 'text') {
            result += token.value;
        }
        else if (token.type === 'specifier') {
            const value = data[dataIndex++];
            result += formatSpecifier(value, token);
        }
    });

    return result;
}

// Helper function to format each specifier
function formatSpecifier(value, { flags, width, precision, specifierType }) {
    let formattedValue;

    switch (specifierType) {
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
            if (precision) {
                formattedValue = formattedValue.slice(0, precision);
            }
            break;
        case '%': // Literal '%'
            return '%';
        default:
            throw new Error(`Unsupported specifier: ${specifierType}`);
    }

    // Handle width and flags (like zero-padding, space, left alignment, sign)
    if (width) {
        const paddingChar = flags.includes('0') && !flags.includes('-') ? '0' : ' ';
        const isLeftAligned = flags.includes('-');
        const needsSign = flags.includes('+') && parseFloat(value) >= 0;
        const needsSpace = flags.includes(' ') && !needsSign && parseFloat(value) >= 0;

        if (needsSign) {
            formattedValue = '+' + formattedValue;
        }
        else if (needsSpace) {
            formattedValue = ' ' + formattedValue;
        }

        if (formattedValue.length < width) {
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



// This is the definition of the printf buffer.
// struct FormattedStruct
// {
//     uint32_t type = 0xFFFFFFFF;
//     uint32_t low = 0;
//     uint32_t high = 0;
// };
//
function hashToString(hashedStrings, hash) {
    for (var i = 0; i < hashedStrings.length; i++) {
        if (hashedStrings[i].hash == hash) {
            return hashedStrings[i].string;
        }
    }
}
function parsePrintfBuffer(hashedString, printfValueResource, bufferElementSize) {

    // Read the printf buffer
    const printfBufferArray = new Uint32Array(printfValueResource.getMappedRange())

    var elementIndex = 0;
    var numberElements = printfBufferArray.byteLength / bufferElementSize;

    // TODO: We currently doesn't support 64-bit data type (e.g. uint64_t, int64_t, double, etc.)
    // so 32-bit array should be able to contain everything we need.
    var dataArray = [];
    const elementSizeInWords = bufferElementSize / 4;
    var outStrArry = [];
    var formatString = "";
    for (elementIndex = 0; elementIndex < numberElements; elementIndex++) {
        var offset = elementIndex * elementSizeInWords;
        const type = printfBufferArray[offset];
        switch (type) {
            case 1: // format string
                formatString = hashToString(hashedString, (printfBufferArray[offset + 1] << 0));  // low field
                break;
            case 2: // normal string
                dataArray.push(hashToString(hashedString, (printfBufferArray[offset + 1] << 0)));  // low field
                break;
            case 3: // integer
                dataArray.push(printfBufferArray[offset + 1]);  // low field
                break;
            case 4: // float
                const floatData = reinterpretUint32AsFloat(printfBufferArray[offset + 1]);
                dataArray.push(floatData);                      // low field
                break;
            case 5: // TODO: We can't handle 64-bit data type yet.
                dataArray.push(0);                              // low field
                break;
            case 0xFFFFFFFF:
                {
                    const parsedTokens = parsePrintfFormat(formatString);
                    const output = formatPrintfString(parsedTokens, dataArray);
                    outStrArry.push(output);
                    formatString = "";
                    dataArray = [];
                    if (elementIndex < numberElements - 1) {
                        const nextOffset = offset + elementSizeInWords;
                        // advance to the next element to see if it's a format string, if it's not we just early return
                        // the results, otherwise just continue processing.
                        if (printfBufferArray[nextOffset] != 1)          // type field
                        {
                            return outStrArry;
                        }
                    }
                    break;
                }
        }
    }

    if (formatString != "") {
        // If we are here, it means that the printf buffer is used up, and we are in the middle of processing
        // one printf string, so we are still going to format it, even though there could be some data missing, which
        // will be shown as 'undef'.
        const parsedTokens = parsePrintfFormat(formatString);
        const output = formatPrintfString(parsedTokens, dataArray);
        outStrArry.push(output);
        outStrArry.push("Print buffer is out of boundary, some data is missing!!!");
    }

    return outStrArry;
}

async function fetchWithProgress(url, onProgress) {
    const response = await fetch(url);
    const contentLength = response.headers.get('Content-Length');

    if (!contentLength) {
        console.warn('Content-Length header is missing.');
        return new Uint8Array(await response.arrayBuffer());
    }

    let total = contentLength ? parseInt(contentLength, 10) : 8 * 1024 * 1024; // Default to 8 MB if unknown
    let buffer = new Uint8Array(total); // Initial buffer
    let position = 0; // Tracks the current position in the buffer

    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Ensure buffer has enough space for the next chunk
        if (position + value.length > buffer.length) {
            // Double the buffer size
            let newBuffer = new Uint8Array(buffer.length * 2);
            newBuffer.set(buffer, 0); // Copy existing data to the new buffer
            buffer = newBuffer;
        }

        // Copy the chunk into the buffer
        buffer.set(value, position);
        position += value.length;

        if (contentLength) {
            onProgress(position, total); // Update progress if content length is known
        }
    }

    return buffer;
}