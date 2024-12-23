import { ReflectionJSON } from './compiler.js';
import { ParsedCommand } from './try-slang.js';

export function configContext(device: GPUDevice, canvas: HTMLCanvasElement) {
    let context = canvas.getContext('webgpu');

    const canvasConfig = {
        device: device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        usage:
            GPUTextureUsage.RENDER_ATTACHMENT,
    };

    if (context == null) {
        throw new Error("Could not get webgpu context")
    }

    context.configure(canvasConfig);
    return context;
}

export function createOutputTexture(device: GPUDevice, width: number, height: number, format: GPUTextureFormat) {
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

function reinterpretUint32AsFloat(uint32: number) {
    const buffer = new ArrayBuffer(4);
    const uint32View = new Uint32Array(buffer);
    const float32View = new Float32Array(buffer);

    uint32View[0] = uint32;
    return float32View[0];
}

/**
 * Here are some patterns we support:
 * 
 * | Attribute                                | Result                        
 * | :--------------------------------------- | :-
 * | `[playground::ZEROS(512)]`                           | Initialize a buffer with zeros of the provided size.
 * | `[playground::BLACK(512, 512)]`                      | Initialize a texture with black of the provided size.
 * | `[playground::URL("https://example.com/image.png")]` | Initialize a texture with image from URL
 * | `[playground::RAND(1000)]`                           | Initialize a float buffer with uniform random floats between 0 and 1.
 */
export function getCommandsFromAttributes(reflection: ReflectionJSON): { resourceName: string; parsedCommand: ParsedCommand; }[] {
    let commands: { resourceName: string, parsedCommand: ParsedCommand }[] = []

    for (let parameter of reflection.parameters) {
        if (parameter.userAttribs == undefined) continue;
        for (let attribute of parameter.userAttribs) {
            let command: ParsedCommand | null = null;

            if(!attribute.name.startsWith("playground_")) continue;

            let playground_attribute_name  =  attribute.name.slice(11)
            if (playground_attribute_name == "ZEROS" || playground_attribute_name == "RAND") {
                command = {
                    type: playground_attribute_name,
                    count: attribute.arguments[0] as number,
                }
            } else if (playground_attribute_name == "BLACK") {
                command = {
                    type: "BLACK",
                    width: attribute.arguments[0] as number,
                    height: attribute.arguments[1] as number,
                }
            } else if (playground_attribute_name == "URL") {
                command = {
                    type: "URL",
                    url: attribute.arguments[0] as string,
                }
            }

            if (command != null) {
                commands.push({
                    resourceName: parameter.name,
                    parsedCommand: command
                })
            }
        }
    }

    return commands
}

export type CallCommand = {
    type: "RESOURCE_BASED",
    fnName: string,
    resourceName: string,
} | {
    type: "FIXED_SIZE",
    fnName: string,
    size: number[],
}

export function parseCallCommands(userSource: string): CallCommand[] {
    // Look for commands of the form:
    //
    // 1. //! CALL(fn-name, SIZE_OF(<resource-name>)) ==> Dispatch a compute pass with the given 
    //                                                    function name and using the resource size
    //                                                    to determine the work-group size.
    // 2. //! CALL(fn-name, 512, 512) ==> Dispatch a compute pass with the given function name and
    //                                    the provided work-group size.
    //

    const callCommands: CallCommand[] = [];
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

type FormatSpecifier = {
    type: "text",
    value: string,
} | {
    type: "specifier",
    flags: string,
    width: number | null,
    precision: number | null,
    specifierType: string,
};

function parsePrintfFormat(formatString: string): FormatSpecifier[] {
    const formatSpecifiers: FormatSpecifier[] = [];
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

        let precision_text = precision ? precision.slice(1) : null; // remove leading '.'
        let precision_number = precision_text ? parseInt(precision) : null

        let width_number = width ? parseInt(width) : null

        // Add the format specifier as a token
        formatSpecifiers.push({
            type: 'specifier',
            flags: flags || '',
            width: width_number,
            precision: precision_number,
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

function formatPrintfString(parsedTokens: FormatSpecifier[], data: any[]) {
    let result = '';
    let dataIndex = 0;

    parsedTokens.forEach((token) => {
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
function formatSpecifier(value: string, { flags, width, precision, specifierType }: FormatSpecifier & { type: 'specifier' }) {
    let formattedValue;
    if (precision == null)
        precision = 6; //eww magic number
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
            formattedValue = parseFloat(value).toFixed(precision);
            break;
        case 'e': // Scientific notation (lowercase)
            formattedValue = parseFloat(value).toExponential(precision);
            break;
        case 'E': // Scientific notation (uppercase)
            formattedValue = parseFloat(value).toExponential(precision).toUpperCase();
            break;
        case 'g':
        case 'G': // Shortest representation of floating-point
            formattedValue = parseFloat(value).toPrecision(precision);
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
function hashToString(hashedStrings: any[], hash: number) {
    for (var i = 0; i < hashedStrings.length; i++) {
        if (hashedStrings[i].hash == hash) {
            return hashedStrings[i].string;
        }
    }
}
export function parsePrintfBuffer(hashedString: any, printfValueResource: GPUBuffer, bufferElementSize: number) {

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

export async function fetchWithProgress(url: string, onProgress: { (loaded: number, total: number): void; }) {
    const response = await fetch(url);
    const contentLength = response.headers.get('Content-Length');

    if (!contentLength) {
        console.warn('Content-Length header is missing.');
        return new Uint8Array(await response.arrayBuffer());
    }

    let total = contentLength ? parseInt(contentLength, 10) : 8 * 1024 * 1024; // Default to 8 MB if unknown
    let buffer = new Uint8Array(total); // Initial buffer
    let position = 0; // Tracks the current position in the buffer

    if (!response.body) {
        // Probably needs to be handled properly
        throw new Error("No response body")
    }
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