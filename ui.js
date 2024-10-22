document.addEventListener("DOMContentLoaded", function () {
  loadEditor(false, "codeEditor", defaultShaderCode);
  loadEditor(true, "diagnostics", "diagnostic space");
  loadEditor(true, "codeGen", "out generation space");

  Split({
    columnGutters: [
      {
        track: 1,
        element: document.querySelector(".mainContainer > .gutter-horizontal"),
      },
    ],
    rowGutters: [
      {
        track: 1,
        element: document.querySelector(".workSpace > .gutter-vertical"),
      },
      {
        track: 1,
        element: document.querySelector(".resultSpace > .gutter-vertical"),
      },
    ],
  });
});
