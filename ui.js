// target -> profile mappings
const targetProfileMap = {
  "SPIR-V": ["spirv_1_3", "spirv_1_4", "spirv_1_5"],
  "HLSL": ["cs", "vs", "ps", "gs", "ds", "hs", "lib"],
  "GLSL": ["glsl_450", "glsl_460"],
};

// Function to update the profile dropdown based on the selected target
function updateProfileOptions(targetSelect, profileSelect) {
  const selectedTarget = targetSelect.value;
  const profiles = targetProfileMap[selectedTarget] || [];

  // Clear the existing options in profile dropdown
  profileSelect.innerHTML = "";

  // Populate the profile dropdown with new options
  profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile;
    option.textContent = profile;
    profileSelect.appendChild(option);
  });
}

function initializeModal() {
  const modal = document.getElementById("helpModal");
  const btn = document.getElementById("helpButton");
  const closeBtn = document.querySelector(".close");

  btn.onclick = () => {
    modal.style.display = "block";
  };

  closeBtn.onclick = () => {
    modal.style.display = "none";
  };

  window.onclick = (event) => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  };
}

function handleDemoDropdown() {
  const demoDropdown = document.getElementById("demo-dropdown");
  const selectInput = demoDropdown.querySelector(".dropdown-select");

  selectInput.addEventListener("change", function () {
    const selectedDemo = this.value;
    switch (selectedDemo) {
      case "Circle":
        monacoEditor.setValue(defaultShaderCode);
        break;
      case "Ocean":
        monacoEditor.setValue(oceanDemoCode);
        break;
    }
    sourceCodeChange = true;
  });
}

document.addEventListener("DOMContentLoaded", function () {
  loadEditor(false, "codeEditor", defaultShaderCode);
  loadEditor(true, "diagnostics", "Diagnostic Output");
  loadEditor(true, "codeGen", "Generated Target Code");

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

  // Target -> Profile handling
  const targetSelect = document.getElementById("target-select");
  const profileSelect = document.getElementById("profile-select");

  updateProfileOptions(targetSelect, profileSelect);

  targetSelect.addEventListener("change", () => {
    updateProfileOptions(targetSelect, profileSelect);
  });

  // modal functionality
  initializeModal();
});

function handleDemoDropdown() {
  const demoDropdown = document.getElementById("demo-dropdown");
  const selectInput = demoDropdown.querySelector(".dropdown-select");

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

var compileDropdownSelection = "WGSL";
function getCurrentCompileTargetOption()
{
  return compileDropdownSelection;
}

// Handle logic for Runnable Dropdown
function handleRunnableDropdown() {
  const runnableDropdown = document.getElementById("runnable-dropdown");
  const selectInput = runnableDropdown.querySelector(".dropdown-select");

  selectInput.addEventListener("change", function () {
    const selectedOption = this.value;
    // Custom logic
  });
}

function handleCompileDropdown() {
  const compileDropdown = document.getElementById("compile-dropdown");
  const selectInput = compileDropdown.querySelector(".dropdown-select");

  selectInput.addEventListener("change", function () {
    compileDropdownSelection = this.value;
  });
}
