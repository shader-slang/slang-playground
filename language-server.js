const userCodeURI = "file:///user.slang";
var languageRegistered = false;
function initMonaco() {
    if (languageRegistered)
        return;
    languageRegistered = true;
    monaco.languages.register({ id: "slang" });
    monaco.languages.setMonarchTokensProvider("slang", {
        keywords: [
            "if", "else", "switch", "case", "default", "return",
            "try", "throw", "throws", "catch", "while", "for",
            "do", "static", "const", "in", "out", "inout",
            "ref", "__subscript", "__init", "property", "get", "set",
            "class", "struct", "interface", "public", "private", "internal",
            "protected", "typedef", "typealias", "uniform", "export", "groupshared",
            "extension", "associatedtype", "this", "namespace", "This", "using",
            "__generic", "__exported", "import", "enum", "break", "continue",
            "discard", "defer", "cbuffer", "tbuffer", "func", "is",
            "as", "nullptr", "none", "true", "false", "functype",
            "sizeof", "alignof", "__target_switch", "__intrinsic_asm",
            "each", "expand", "throws", "static", "const", "in", "out", "inout",
            "ref", "__subscript", "__init", "property", "get", "set",
            "class", "struct", "interface", "public", "private", "internal",
            "protected", "typedef", "typealias", "uniform", "export", "groupshared",
            "extension", "associatedtype", "namespace", "This", "using",
            "__generic", "__exported", "import", "enum", "cbuffer", "tbuffer", "func",
            "functype", "typename", "each", "expand", "where"
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
                // identifiers and keywords
                [/\@?[a-zA-Z_]\w*/, {
                    cases: {
                        '@typeKeywords': 'keyword',
                        '@namespaceFollows': { token: 'keyword.$0', next: '@namespace' },
                        '@keywords': { token: 'keyword.$0', next: '@qualified' },
                        '@default': { token: 'identifier', next: '@qualified' }
                    }
                }],

                [/((bool|int|uint|float|int16_t|uint16_t|int32_t|uint32_t|int64_t|uint64_t|int8_t|uint8_t|half|float|double)(1|2|3|4)?)|void/, 'keyword'],

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

                // @ annotations.
                // As an example, we emit a debugging log message on these tokens.
                // Note: message are supressed during the first load -- change some lines to see them.
                [/@\s*[a-zA-Z_\$][\w\$]*/, { token: 'annotation', log: 'annotation token: $0' }],

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

    monaco.editor.defineTheme("slang-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "function", foreground: "DCDCAA" },
            { token: "parameter", foreground: "B0B0B0" },
            { token: "variable", foreground: "8CDCFE" },
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
                contents: [{ value: result.contents.value }],
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
            var resultArray = [];
            for (var i = 0; i < result.size(); i++) {
                let lspResult = result.get(i);
                resultArray.push({
                    uri: monaco.Uri.parse(lspResult.uri),
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
            let lspContext = {
                triggerKind: context.triggerKind,
                triggerCharacter: context.hasOwnProperty("triggerCharacter") ? context.triggerCharacter : ""
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
            var curRange = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };
            for (var i = 0; i < result.size(); i++) {
                let lspItem = result.get(i);
                var item = {
                    label: lspItem.label,
                    kind: lspItem.kind,
                    detail: lspItem.detail,
                    documentation: lspItem.documentation.value,
                    insertText: lspItem.label,
                    range: curRange
                };
                items.push(item)
            }
            return { suggestions: items };
        }
    });

    monaco.languages.registerSignatureHelpProvider("slang", {
        signatureHelpTriggerCharacters: ["(", ","],
        signatureHelpRetriggerCharacters: [","],
        provideSignatureHelp: function (model, position) {
            if (slangd == null) {
                return null;
            }
            let result = slangd.signatureHelp(userCodeURI, { line: position.lineNumber - 1, character: position.column - 1 });
            if (result == null) {
                return null;
            }
            let sigs = [];
            for (var i = 0; i < result.signatures.size(); i++) {
                let lspSignature = result.signatures.get(i);
                let params = [];
                for (var j = 0; j < lspSignature.parameters.size(); j++) {
                    let lspParameter = lspSignature.parameters.get(j);
                    params.push({
                        label: [lspParameter.label[0], lspParameter.label[1]],
                        documentation: lspParameter.documentation.value
                    });
                }
                let signature = {
                    label: lspSignature.label,
                    documentation: lspSignature.documentation.value,
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
            for (var i = 0; i < result.size(); i++) {
                rawData[i] = result.get(i);
            }
            return {
                data: rawData
            };
        }
    });
}

function initLanguageServer() {
    var text = "";
    if (monacoEditor)
    {
        text = monacoEditor.getValue();
    }
    slangd.didOpenTextDocument(userCodeURI, text);
}

var diagnosticTimeout = null;

function translateSeverity(severity) {
    switch(severity)
    {
        case 1:
            return monaco.MarkerSeverity.Error;
        case 2:
            return monaco.MarkerSeverity.Warning;
        case 3:
            return monaco.MarkerSeverity.Information;
        case 4:
            return monaco.MarkerSeverity.Hint;
        default:
            return monaco.MarkerSeverity.Error;
    }
}

function codeEditorChangeContent(e) {
    if (slangd == null)
        return;
    let lspChanges = new compiler.slangWasmModule.TextEditList();

    e.changes.forEach(change =>
        lspChanges.push_back(
            {
                range: {
                    start: { line: change.range.startLineNumber - 1, character: change.range.startColumn - 1 },
                    end: { line: change.range.endLineNumber - 1, character: change.range.endColumn - 1 }
                },
                text: change.text
            }
        ));
    try {
        slangd.didChangeTextDocument(userCodeURI, lspChanges);
        if (diagnosticTimeout != null) {
            clearTimeout(diagnosticTimeout);
        }
        diagnosticTimeout = setTimeout(() => {
            let diagnostics = slangd.getDiagnostics(userCodeURI);
            if (diagnostics == null) {
                monaco.editor.setModelMarkers(monacoEditor.getModel(), "slang", []);
                return;
            }
            var markers = [];
            for (var i = 0; i < diagnostics.size(); i++) {
                let lspDiagnostic = diagnostics.get(i);
                markers.push({
                    startLineNumber: lspDiagnostic.range.start.line + 1,
                    startColumn: lspDiagnostic.range.start.character + 1,
                    endLineNumber: lspDiagnostic.range.end.line + 1,
                    endColumn: lspDiagnostic.range.end.character + 1,
                    message: lspDiagnostic.message,
                    severity: translateSeverity(lspDiagnostic.severity),
                    code: lspDiagnostic.code
                });
            }
            monaco.editor.setModelMarkers(monacoEditor.getModel(), "slang", markers);
            diagnosticTimeout = null;
        }, 500);

    }
    finally {
        lspChanges.delete();
    }

}
