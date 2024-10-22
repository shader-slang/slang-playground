document.addEventListener("DOMContentLoaded", function () {
  loadEditor(false, "codeEditor", defaultShaderCode);
  loadEditor(true, "diagnostics", "diagnostic space");
  loadEditor(true, "codeGen", "out generation space");
});
