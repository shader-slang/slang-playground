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

  handleDemoDropdown();
  handleRunnableDropdown();
  handleCompileDropdown();
});

function handleDemoDropdown() {
  const demoDropdown = document.getElementById("demo-dropdown");
  const selectInput = demoDropdown.querySelector(".dropdown-input");

  selectInput.addEventListener("change", function () {
    const selectedDemo = this.value;
    switch (selectedDemo) {
      case "Circles":
        monacoEditor.setValue(defaultShaderCode);
        break;
      case "Water":
        monacoEditor.setValue(oceanDemoCode);
        break;
    }

    // Trigger source code change
    sourceCodeChange = true;
  });
}

// Handle logic for Runnable Dropdown
function handleRunnableDropdown() {
  const runnableDropdown = document.getElementById("runnable-dropdown");
  const selectInput = runnableDropdown.querySelector(".dropdown-input");

  selectInput.addEventListener("change", function () {
    const selectedOption = this.value;
    // Custom logic
  });
}

function handleCompileDropdown() {
  const compileDropdown = document.getElementById("compile-dropdown");
  const selectInput = compileDropdown.querySelector(".dropdown-input");

  selectInput.addEventListener("change", function () {
    const selectedOption = this.value;
    // Custom logic
  });
}
