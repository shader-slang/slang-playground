import { slangd } from './try-slang.js';
import { playgroundSource } from './playgroundShader.js';
import type { CompletionContext } from './slang-wasm.js';

import * as monaco from "monaco-editor";

export const userCodeURI = "file:///user.slang";
const playgroundCodeURI = "file:///playground.slang";
let languageRegistered = false;
export function initMonaco() {
    if (languageRegistered)
        return;
    languageRegistered = true;
    monaco.languages.register({ id: "slang" });
    monaco.languages.setMonarchTokensProvider("slang", {
        keywords: [
            "if", "else", "switch", "case", "default", "return",
            "try", "throw", "throws", "catch", "while", "for",
            "let", "var", "spirv_asm", "no_diff", "dynamic_uniform",
            "fwd_diff", "bwd_diff", "module", "implementing",
            "__include", "__dispatch_kernel",
            "row_major", "column_major", "nointerpolation", "snorm",
            "unorm", "globallycoherent", "extern", "layout",
            "do", "static", "const", "in", "out", "inout",
            "ref", "__subscript", "__init", "property", "get", "set",
            "class", "struct", "interface", "public", "private", "internal",
            "protected", "typedef", "typealias", "uniform", "export", "groupshared",
            "extension", "associatedtype", "this", "namespace", "This", "using",
            "__generic", "__exported", "import", "enum", "break", "continue",
            "discard", "defer", "cbuffer", "tbuffer", "func", "is",
            "as", "nullptr", "none", "true", "false", "functype",
            "sizeof", "alignof", "__target_switch", "__intrinsic_asm",
            "typename", "each", "expand", "where", "register", "packoffset",
        ],
        brackets: [
            { open: '{', close: '}', token: 'delimiter.curly' },
            { open: '[', close: ']', token: 'delimiter.square' },
            { open: '(', close: ')', token: 'delimiter.parenthesis' },
            { open: '<', close: '>', token: 'delimiter.angle' }
        ],
        namespaceFollows: [
            'namespace', 'using',
        ],
        typeKeywords: [
            'bool', 'double', 'uint', 'int', 'short', 'char', 'void', 'float'
        ],

        operators: [
            '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
            '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
            '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=',
            '%=', '<<=', '>>=', '>>>='
        ],

        // we include these common regular expressions
        symbols: /[=><!~?:&|+\-*\/\^%]+/,

        // C# style strings
        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

        // The main tokenizer for our languages
        tokenizer: {
            root: [
                // C++ raw string literal
                [/(R"([a-zA-Z0-9_]*?)\()/, { token: 'string.raw.quote', next: '@rawstring.$2' }], // Capture delimiter and enter raw string state

                // Builtin types
                [/(((RW|RasterizerOrdered|Feedback)?(StructuredBuffer|Texture[A-Za-z0-9]+|ByteAddressBuffer))|ConstantBuffer|ParameterBlock|SamplerState|SamplerComparisonState|(image|sampler)[A-Z0-9]+D(Array)?(MS)?(Shadow)?)\b/, 'type'],
                [/(bool|int|uint|float|int16_t|uint16_t|int32_t|uint32_t|int64_t|uint64_t|int8_t|uint8_t|half|float|double|vec|ivec|mat)((1|2|3|4)(x(1|2|3|4))?)?\b/, 'keyword'],

                // identifiers and keywords
                [/\@?[a-zA-Z_]\w*/, {
                    cases: {
                        '@typeKeywords': 'keyword',
                        '@namespaceFollows': { token: 'keyword.$0', next: '@namespace' },
                        '@keywords': { token: 'keyword.$0', next: '@qualified' },
                        '@default': { token: 'identifier', next: '@qualified' },
                    }
                }],

                // Preprocessor directives
                [/#[a-z]+\w*/, 'keyword'],

                // whitespace
                { include: '@whitespace' },

                // delimiters and operators
                [/[{}()\[\]]/, '@brackets'],
                [/[<>](?!@symbols)/, '@brackets'],
                [/@symbols/, {
                    cases: {
                        '@operators': 'operator',
                        '@default': ''
                    }
                }],

                // numbers
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/\d+/, 'number'],

                // delimiter: after number because of .\d floats
                [/[;,.]/, 'delimiter'],

                // strings
                [/"([^"\\]|\\.)*$/, 'string.invalid'],  // non-teminated string
                [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

                // characters
                [/'[^\\']'/, 'string'],
                [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
                [/'/, 'string.invalid']
            ],

            comment: [
                [/[^\/*]+/, 'comment'],
                [/\/\*/, 'comment', '@push'],    // nested comment
                ["\\*/", 'comment', '@pop'],
                [/[\/*]/, 'comment']
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/@escapes/, 'string.escape'],
                [/\\./, 'string.escape.invalid'],
                [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            rawstring: [
                // Closing of raw string literal with matching delimiter
                [/\)([a-zA-Z0-9_]*?)"/, {
                    cases: {
                        '$1==$S2': { token: 'string.raw.quote', next: '@pop' }, // Match delimiter with initial delimiter
                        '@default': 'string.raw'  // Otherwise, continue within raw string
                    }
                }],
                [/./, 'string.raw'] // Match any character within the raw string
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white'],
                [/\/\*/, 'comment', '@comment'],
                [/\/\/.*$/, 'comment'],
            ],
            qualified: [
                [/[a-zA-Z_][\w]*/, {
                    cases: {
                        '@keywords': { token: 'keyword.$0' },
                        '@default': 'identifier'
                    }
                }],
                [/\./, 'delimiter'],
                ['', '', '@pop'],
            ],
            namespace: [
                { include: '@whitespace' },
                [/[A-Z]\w*/, 'namespace'],
                [/[\.=]/, 'delimiter'],
                ['', '', '@pop'],
            ],
        },
    });

    // A general highlighting rule for all shading languages we care about.
    monaco.languages.register({ id: "generic-shader" });
    monaco.languages.setMonarchTokensProvider("generic-shader", {
        keywords: [
            "if", "else", "switch", "case", "default", "return",
            "while", "for", "do", "static", "const", "in", "out", "inout",
            "ref", "class", "struct", "interface", "public", "private", "internal",
            "protected", "typedef", "uniform", "export", "groupshared",
            "this", "namespace", "using", "enum", "break", "continue",
            "discard", "cbuffer", "tbuffer", "true", "false",
            "sizeof", "alignof", "layout", "buffer", "register",
            "packoffset", "nointerpolation"
        ],
        brackets: [
            { open: '{', close: '}', token: 'delimiter.curly' },
            { open: '[', close: ']', token: 'delimiter.square' },
            { open: '(', close: ')', token: 'delimiter.parenthesis' },
            { open: '<', close: '>', token: 'delimiter.angle' }
        ],
        namespaceFollows: [
            'namespace', 'using',
        ],
        typeKeywords: [
            'bool', 'double', 'uint', 'int', 'short', 'char', 'void', 'float'
        ],
        operators: [
            '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
            '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
            '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=',
            '%=', '<<=', '>>=', '>>>='
        ],

        // we include these common regular expressions
        symbols: /[=><!~?:&|+\-*\/\^%]+/,

        // C# style strings
        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

        // The main tokenizer for our languages
        tokenizer: {
            root: [
                [/(((RW|RasterizerOrdered|Feedback)?(StructuredBuffer|Texture[A-Za-z0-9]+|ByteAddressBuffer))|ConstantBuffer|SamplerState|SamplerComparisonState|(image|sampler)[A-Z0-9]+D(Array)?(MS)?(Shadow)?)\b/, 'type'],
                [/(bool|int|uint|float|int16_t|uint16_t|int32_t|uint32_t|int64_t|uint64_t|int8_t|uint8_t|half|float|double|vec|ivec|mat)((1|2|3|4)(x(1|2|3|4))?)?\b/, 'keyword'],

                // Match function names
                [/\b([a-zA-Z_][\w]*)\s*(?=\()/, {
                    cases: {
                        '@keywords': 'keyword', // Use this if you have keywords to highlight
                        '@default': 'function' // Apply 'functionName' class for function names
                    }
                }],

                // other identifiers and keywords
                [/\@?[a-zA-Z_]\w*/, {
                    cases: {
                        '@typeKeywords': 'keyword',
                        '@namespaceFollows': { token: 'keyword.$0', next: '@namespace' },
                        '@keywords': { token: 'keyword.$0', next: '@qualified' },
                        '@default': { token: 'identifier', next: '@qualified' }
                    }
                }],

                // Preprocessor directives
                [/#[a-z]+\w*/, 'keyword'],

                // whitespace
                { include: '@whitespace' },

                // delimiters and operators
                [/[{}()\[\]]/, '@brackets'],
                [/[<>](?!@symbols)/, '@brackets'],
                [/@symbols/, {
                    cases: {
                        '@operators': 'operator',
                        '@default': ''
                    }
                }],

                // numbers
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/\d+/, 'number'],

                // delimiter: after number because of .\d floats
                [/[;,.]/, 'delimiter'],

                // strings
                [/"([^"\\]|\\.)*$/, 'string.invalid'],  // non-teminated string
                [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

                // characters
                [/'[^\\']'/, 'string'],
                [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
                [/'/, 'string.invalid']
            ],

            comment: [
                [/[^\/*]+/, 'comment'],
                [/\/\*/, 'comment', '@push'],    // nested comment
                ["\\*/", 'comment', '@pop'],
                [/[\/*]/, 'comment']
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/@escapes/, 'string.escape'],
                [/\\./, 'string.escape.invalid'],
                [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white'],
                [/\/\*/, 'comment', '@comment'],
                [/\/\/.*$/, 'comment'],
            ],
            qualified: [
                [/[a-zA-Z_][\w]*/, {
                    cases: {
                        '@keywords': { token: 'keyword.$0' },
                        '@default': 'identifier'
                    }
                }],
                [/\./, 'delimiter'],
                ['', '', '@pop'],
            ],
            namespace: [
                { include: '@whitespace' },
                [/[A-Z]\w*/, 'namespace'],
                [/[\.=]/, 'delimiter'],
                ['', '', '@pop'],
            ],
        },
    });

    monaco.languages.register({ id: "spirv" });
    monaco.languages.setMonarchTokensProvider("spirv", {
        operators: [
            '=',
        ],

        symbols: /[=><!~?:&|+\-*\/\^%]+/,

        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

        tokenizer: {
            root: [
                // SPIRV-opcode
                [/Op[A-Za-z]*Decorate\b/, 'keyword'],
                [/OpFunction\b/, 'keyword'],
                [/OpLabel\b/, 'parameter'],
                [/Op[A-Za-z]*Name\b/, 'parameter'],
                [/OpType[A-Za-z0-9]+\b/, 'type'],
                [/Op[A-Z][A-Za-z0-9]+\w*/, 'function'],

                // other identifiers and keywords
                [/[A-Z][a-zA-Z0-9_]+\b/, 'enumMember'],

                // SPIRV-variable
                [/%[A-Za-z0-9_]+\w*/, 'variable'],

                // whitespace
                { include: '@whitespace' },

                // Comments
                [/;.*/, 'comment'],

                // delimiters and operators
                [/@symbols/, {
                    cases: {
                        '@operators': 'operator',
                        '@default': ''
                    }
                }],

                // numbers
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/\d+/, 'number'],

                // delimiter: after number because of .\d floats
                [/[;,.]/, 'delimiter'],

                // strings
                [/"([^"\\]|\\.)*$/, 'string.invalid'],  // non-teminated string
                [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],

                // characters
                [/'[^\\']'/, 'string'],
                [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
                [/'/, 'string.invalid']
            ],

            string: [
                [/[^\\"]+/, 'string'],
                [/@escapes/, 'string.escape'],
                [/\\./, 'string.escape.invalid'],
                [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
            ],

            whitespace: [
                [/[ \t\r\n]+/, 'white'],
            ],
        },
    });

    monaco.languages.registerDefinitionProvider("spirv", {
        provideDefinition: function (model, position) {
            const word = model.getWordAtPosition(position);
            if (!word) return null;

            const wordRange = new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn
            );

            // Extract the identifier under the cursor
            const identifier = word.word;

            // Find the definition of the identifier (either a register or function)
            for (let i = 1; i <= model.getLineCount(); i++) {
                const lineContent = model.getLineContent(i);

                // Check for register definitions (%register)
                if (lineContent.includes(`${identifier} =`)) {
                    return {
                        range: new monaco.Range(i, 1, i, lineContent.length + 1),
                        uri: model.uri
                    };
                }

                // Check for function definitions (OpFunction)
                if (lineContent.includes(`OpFunction ${identifier}`)) {
                    return {
                        range: new monaco.Range(i, 1, i, lineContent.length + 1),
                        uri: model.uri
                    };
                }
            }

            // Return null if no definition was found
            return null;
        }
    });

    monaco.languages.registerHoverProvider('spirv', {
        provideHover: function (model, position) {
            const word = model.getWordAtPosition(position);
            if (!word) return null;

            const identifier = word.word;
            let currentFunction = null;

            // Check for %register or OpFunction definitions
            for (let i = 1; i <= model.getLineCount(); i++) {
                const lineContent = model.getLineContent(i);

                // Detect function definitions
                if (lineContent.includes(`OpFunction`)) {
                    const funcMatch = lineContent.match(/%?(\w+)\s+=\s+OpFunction\s+/);
                    if (funcMatch) {
                        currentFunction = funcMatch[1]; // Store the current function name
                    }
                }

                // Detect function end to reset the current function
                if (lineContent.includes(`OpFunctionEnd`)) {
                    currentFunction = null;
                }

                // Hover text for register
                if (lineContent.includes(`${identifier} =`)) {
                    let hoverContents = [
                        { value: `**Register:** \`${identifier}\`` },
                        { value: '---' },
                        { value: `**Definition:** \n\n\`${lineContent.trim()}\`` }
                    ];
                    // Add function context if inside a function
                    if (currentFunction) {
                        hoverContents.push({ value: `**In Function:** \`${currentFunction}\`` });
                    }
                    return {
                        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                        contents: hoverContents
                    };
                }

                // Hover text for function
                if (lineContent.includes(`OpFunction ${identifier}`)) {
                    return {
                        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                        contents: [
                            { value: `**Function:** \`${identifier}\`` },
                            { value: '---' },
                            { value: `**Definition:** \n\n\`${lineContent.trim()}\`` }
                        ]
                    };
                }
            }

            // If no match is found, return null
            return null;
        }
    });

    monaco.editor.defineTheme("slang-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "function", foreground: "DCDCAA" },
            { token: "parameter", foreground: "B0B0B0" },
            { token: "variable", foreground: "8CDCFE" },
            { token: "enumMember", foreground: "98AD1C" },
        ],
        colors: {
            "editor.foreground": "#F0F0F0",
        },
    });

    monaco.languages.registerHoverProvider("slang", {
        provideHover: function (model, position) {
            if (slangd == null) {
                return null;
            }
            let result = slangd.hover(userCodeURI, { line: position.lineNumber - 1, character: position.column - 1 });
            if (result == null) {
                return null;
            }
            return {
                contents: [{ value: result.contents.value.toString() }],
                range: {
                    startLineNumber: result.range.start.line + 1,
                    startColumn: result.range.start.character + 1,
                    endLineNumber: result.range.end.line + 1,
                    endColumn: result.range.end.character + 1
                }
            };
        }
    });
    monaco.languages.registerDefinitionProvider("slang", {
        provideDefinition: function (model, position) {
            if (slangd == null) {
                return null;
            }
            let result = slangd.gotoDefinition(userCodeURI, { line: position.lineNumber - 1, character: position.column - 1 });
            if (result == null) {
                return null;
            }
            let resultArray = [];
            for (let i = 0; i < result.size(); i++) {
                let lspResult = result.get(i);
                if (lspResult == undefined) {
                    throw new Error("Invalid state!");
                }
                resultArray.push({
                    uri: monaco.Uri.parse(lspResult.uri.toString()),
                    range: {
                        startLineNumber: lspResult.range.start.line + 1,
                        startColumn: lspResult.range.start.character + 1,
                        endLineNumber: lspResult.range.end.line + 1,
                        endColumn: lspResult.range.end.character + 1
                    }
                });
            }
            return resultArray;
        }
    });
    monaco.languages.registerCompletionItemProvider("slang", {
        triggerCharacters: [".", ":", ">", "(", "<", " ", "["],
        provideCompletionItems: function (model, position, context) {
            if (slangd == null) {
                return null;
            }
            let lspContext: CompletionContext = {
                triggerKind: context.triggerKind,
                triggerCharacter: context.hasOwnProperty("triggerCharacter") ? (context.triggerCharacter || "") : ""
            };
            let result = slangd.completion(
                userCodeURI,
                { line: position.lineNumber - 1, character: position.column - 1 },
                lspContext
            );
            if (result == null) {
                return null;
            }
            let items = [];
            let word = model.getWordAtPosition(position);
            if (word == null)
                word = model.getWordUntilPosition(position);
            let curRange = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };
            for (let i = 0; i < result.size(); i++) {
                let lspItem = result.get(i);
                if (lspItem == undefined) {
                    throw new Error("Invalid state!");
                }
                let item: monaco.languages.CompletionItem = {
                    label: lspItem.label.toString(),
                    kind: lspItem.kind,
                    detail: lspItem.detail.toString(),
                    documentation: (lspItem.documentation?.value || "").toString(),
                    insertText: lspItem.label.toString(),
                    range: curRange
                };
                items.push(item);
            }
            return { suggestions: items };
        }
    });

    monaco.languages.registerSignatureHelpProvider("slang", {
        signatureHelpTriggerCharacters: ["(", ","],
        signatureHelpRetriggerCharacters: [","],
        provideSignatureHelp: function (model, position, _a, _b): monaco.languages.ProviderResult<monaco.languages.SignatureHelpResult> {
            if (slangd == null) {
                return null;
            }
            let result = slangd.signatureHelp(userCodeURI, { line: position.lineNumber - 1, character: position.column - 1 });
            if (result == null) {
                return null;
            }
            let sigs: monaco.languages.SignatureInformation[] = [];
            for (let i = 0; i < result.signatures.size(); i++) {
                let lspSignature = result.signatures.get(i);
                if (lspSignature == undefined) {
                    throw new Error("Invalid state!");
                }
                let params: monaco.languages.ParameterInformation[] = [];
                for (let j = 0; j < lspSignature.parameters.size(); j++) {
                    let lspParameter = lspSignature.parameters.get(j);
                    if (lspParameter == undefined) {
                        throw new Error("Invalid state!");
                    }
                    params.push({
                        label: [lspParameter.label[0], lspParameter.label[1]],
                        documentation: lspParameter.documentation.value.toString()
                    });
                }
                let signature: monaco.languages.SignatureInformation = {
                    label: lspSignature.label.toString(),
                    documentation: lspSignature.documentation.value.toString(),
                    parameters: params
                };
                sigs.push(signature);
            }
            return {
                value: {
                    signatures: sigs,
                    activeSignature: result.activeSignature,
                    activeParameter: result.activeParameter
                },
                dispose: function () { }
            };
        }
    });

    monaco.languages.registerDocumentRangeSemanticTokensProvider("slang", {
        getLegend: function () {
            return {
                tokenTypes: [
                    "type",
                    "enumMember",
                    "variable",
                    "parameter",
                    "function",
                    "property",
                    "namespace",
                    "keyword",
                    "macro",
                    "string",
                ],
                tokenModifiers: []
            };
        },
        provideDocumentRangeSemanticTokens: function (model, range, token) {
            if (slangd == null) {
                return null;
            }
            let result = slangd.semanticTokens(userCodeURI);
            if (result == null) {
                return null;
            }
            let rawData = new Uint32Array(result.size());
            for (let i = 0; i < result.size(); i++) {
                let indexedResult = result.get(i);
                if (indexedResult == undefined) {
                    throw new Error("Invalid state!");
                }
                rawData[i] = indexedResult;
            }
            return {
                data: rawData,
            };
        }
    });
}

export function initLanguageServer() {
    if (slangd == null) {
        throw new Error("Slang is undefined!");
    }
    slangd.didOpenTextDocument(userCodeURI, "");
    slangd.didOpenTextDocument(playgroundCodeURI, playgroundSource);
}

export function translateSeverity(severity: number) {
    switch (severity) {
        case 1:
            return monaco.MarkerSeverity.Error;
        case 2:
            return monaco.MarkerSeverity.Warning;
        case 3:
            return monaco.MarkerSeverity.Info;
        case 4:
            return monaco.MarkerSeverity.Hint;
        default:
            return monaco.MarkerSeverity.Error;
    }
}
