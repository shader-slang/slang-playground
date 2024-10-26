const userCodeURI = "file:///user.slang";
var languageRegistered = false;
function initMonaco() {
    if (languageRegistered)
        return;
    languageRegistered = true;
    monaco.languages.register({ id: "slang" });
    monaco.languages.registerHoverProvider("slang", {
        provideHover: function (model, position) {
            if (slangd == null) {
                return null;
            }
            let result = slangd.hover(userCodeURI, { line: position.lineNumber-1, character: position.column-1 });
            if (result == null) {
                return null;
            }
            return {
                contents: [{ value: result.contents.value }],
                range: {
                    startLineNumber: result.range.start.line+1,
                    startColumn: result.range.start.character+1,
                    endLineNumber: result.range.end.line+1,
                    endColumn: result.range.end.character+1
                }
            };
        }
    });
    monaco.languages.registerCompletionItemProvider("slang", {
        triggerCharacters: [".", ":"],
        provideCompletionItems: function (model, position, context) {
            if (slangd == null) {
                return null;
            }
            let lspContext = { 
                triggerKind: context.triggerKind,
                triggerCharacter: context.hasOwnProperty("triggerCharacter")?context.triggerCharacter:""
            };
            let result = slangd.completion(
                userCodeURI,
                { line: position.lineNumber-1, character: position.column-1 },
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
            return { suggestions: items};
        }
    });
}

function initLanguageServer()
{
    var text = "";
    if (monacoEditor)
        text = monacoEditor.getValue();
    slangd.didOpenTextDocument(userCodeURI, text);
}

function codeEditorChangeContent(e) {
    if (slangd == null)
        return;
    let lspChanges = new compiler.slangWasmModule.TextEditList();

    e.changes.forEach(change =>
        lspChanges.push_back(
            {
                range: {
                    start: { line: change.range.startLineNumber-1, character: change.range.startColumn-1 },
                    end: { line: change.range.endLineNumber-1, character: change.range.endColumn-1 }
                },
                text: change.text
            }
        ));
    try {
        slangd.didChangeTextDocument(userCodeURI, lspChanges);
    }
    finally
    {
        lspChanges.delete();
    }

}
