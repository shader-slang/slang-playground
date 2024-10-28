// target -> profile mappings
const targetProfileMap = {
  // TODO: uncomment when we support specifying profiles.
  //"SPIRV": {default:"1.5", options:["1.3", "1.4", "1.5", "1.6"]},
};

var entrypointSelect = null;

// Function to update the profile dropdown based on the selected target
function updateProfileOptions(targetSelect, profileSelect) {
  const selectedTarget = targetSelect.value;
  // Clear the existing options in profile dropdown
  profileSelect.innerHTML = "";

  // If the selected target does not have any profiles, hide the profile dropdown.
  const profiles = targetProfileMap[selectedTarget] || null;
  if (!profiles) {
    document.getElementById("profile-dropdown").style.display = "none";
  }
  else{
    document.getElementById("profile-dropdown").style = "";

    // Populate the profile dropdown with new options
    profiles.options.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile;
      option.textContent = profile;
      profileSelect.appendChild(option);
    });
    profileSelect.value = profiles.default;
  }

  // If the target can be compiled as a whole program without entrypoint selection, hide the entrypoint dropdown.
  if (isWholeProgramTarget(targetSelect.value)) {
    document.getElementById("entrypoint-dropdown").style.display = "none";
  } else {
    document.getElementById("entrypoint-dropdown").style = "";
    updateEntryPointOptions();
  }
}

function updateEntryPointOptions()
{
  if (!compiler)
    return;
  if (!entrypointSelect)
    return;
  const prevValue = entrypointSelect.value;
  entrypointSelect.innerHTML = "";
  var defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Entrypoint";
  defaultOption.disabled = true;
  entrypointSelect.appendChild(defaultOption);

  const entryPoints = compiler.findDefinedEntryPoints(monacoEditor.getValue());
  var prevValueExists = false;
  entryPoints.forEach((entryPoint) => {
    const option = document.createElement("option");
    option.value = entryPoint;
    option.textContent = entryPoint;
    entrypointSelect.appendChild(option);
    if (entryPoint === prevValue)
    {
      option.selected = true;
      prevValueExists = true;
    }
  });
  if (prevValue == "" && entryPoints.length > 0)
    entrypointSelect.value = entryPoints[0];
  else if (prevValueExists)
    entrypointSelect.value = prevValue;
  else
  {
    entrypointSelect.value = "";
    defaultOption.selected = true;
  }
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
  entrypointSelect = document.getElementById("entrypoint-select");
  entrypointSelect.addEventListener('focus', updateEntryPointOptions); // for keyboard access
  entrypointSelect.addEventListener('mousedown', updateEntryPointOptions); // for mouse access

  updateProfileOptions(targetSelect, profileSelect);

  targetSelect.addEventListener("change", () => {
    updateProfileOptions(targetSelect, profileSelect);
  });

  // modal functionality
  initializeModal();
});
