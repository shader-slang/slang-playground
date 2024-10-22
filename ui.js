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

  initializeDemoDropdown();
});

function initializeDemoDropdown() {
  const demoDropdown = document.getElementById("demo-dropdown");
  if (!demoDropdown) return;

  const demoLinks = demoDropdown.querySelectorAll(".dropdown-content a");
  const demoButton = demoDropdown.querySelector(".dropdown-btn");

  demoLinks.forEach((link) => {
    link.addEventListener("click", function (e) {
      e.preventDefault();

      const selectedDemo = this.textContent;

      switch (selectedDemo) {
        case "Circles":
          monacoEditor.setValue(defaultShaderCode);
          break;
        case "Water":
          monacoEditor.setValue(oceanDemoCode);
          break;
      }

      demoButton.innerHTML = `${selectedDemo}  &#9662;`;

      // Trigger source code change
      sourceCodeChange = true;
    });
  });
}
