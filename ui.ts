import { monacoEditor, compiler, compileOrRun, onCompile } from './try-slang.js';
import { demoList } from './demos/demo-list.js';
import { isWholeProgramTarget } from './compiler.js';
import { loadEditor } from './try-slang.js';
import Split from 'split-grid';
import pako from 'pako';

// target -> profile mappings
const targetProfileMap: {[target: string]: {default: string, options: string[]}} = {
  // TODO: uncomment when we support specifying profiles.
  // "SPIRV": {default:"1.5", options:["1.3", "1.4", "1.5", "1.6"]},
};

var entrypointSelect: HTMLInputElement | null = null;

// Function to update the profile dropdown based on the selected target
function updateProfileOptions(targetSelect: HTMLSelectElement, profileSelect: HTMLSelectElement) {
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
    document.getElementById("entrypoint-select").value = "";
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
  for(let entryPoint of entryPoints) {
    const option = document.createElement("option");
    option.value = entryPoint;
    option.textContent = entryPoint;
    entrypointSelect.appendChild(option);
    if (entryPoint === prevValue)
    {
      option.selected = true;
      prevValueExists = true;
    }
  }
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

// Set all containers to overflow:hidden before resizing so they can properly shrink.
function prepareForResize() {
  var codeEditors = document.getElementsByClassName("editorContainer");

  for (var i = 0; i < codeEditors.length; i++) {
    if (codeEditors[i].style.display == "none")
      continue;
    codeEditors[i].style.overflow = "hidden";
  }
  document.getElementById("workSpaceDiv").style.overflow = "hidden";
  document.getElementById("leftContainerDiv").style["overflow-x"] = "hidden";
  targetResultContainer.style.overflow = "hidden";
}
// Restore the containers to overflow:visible after resizing.
function finishResizing() {
    var codeEditors = document.getElementsByClassName("editorContainer");
    document.getElementById("workSpaceDiv").style.overflow = "visible";
    var leftContainer = document.getElementById("leftContainerDiv");
    if (leftContainer.clientWidth < 30)
      leftContainer.style["overflow-x"] = "hidden";
    else
      leftContainer.style["overflow-x"] = "visible";
    for (var i = 0; i < codeEditors.length; i++) {
      if (codeEditors[i].style.display == "none")
        continue;
      if (codeEditors[i].clientHeight < 30)
        codeEditors[i].parentNode.style.overflow = "hidden";
      codeEditors[i].style.overflow = "visible";
    }
    document.getElementById("reflectionTab").style["max-width"] = document.getElementById("rightContainerDiv").clientWidth + "px";
    
    var canvasRect = document.getElementById("canvas").getBoundingClientRect();
    
    renderOverlay.style.top = 5 + "px";
    renderOverlay.style.left = (canvasRect.left + 5) + "px";
    renderOverlay.style.display = canvasRect.height> 30?"block":"none";
    resetMouse();
}

var finishResizingTimeout: number | null = null;
window.onresize = function () {
  prepareForResize();
  if (finishResizingTimeout)
    clearTimeout(finishResizingTimeout);
  finishResizingTimeout = setTimeout(() => {
    finishResizing();
    finishResizingTimeout = null;
  }, 50);
};

function initializeModal() {
  const modal = document.getElementById("helpModal");
  const btn = document.getElementById("helpButton");
  const closeBtn = document.querySelector(".close");

  btn.onclick = () => {
    modal.style.display = "flex";
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

export function loadDemo(selectedDemoURL: string) {
  if (selectedDemoURL != "")
  {
    // Is `selectedDemoURL` a relative path?
    var finalURL;
    if (!selectedDemoURL.startsWith("http"))
    {
      // If so, append the current origin to it.
      // Combine the url to point to demos/${selectedDemoURL}.
      finalURL = new URL("demos/" + selectedDemoURL, window.location.href);
    }
    else
    {
      finalURL = new URL(selectedDemoURL);
    }
    // Retrieve text from selectedDemoURL.
    fetch(finalURL)
      .then((response) => response.text())
      .then((data) => {
        monacoEditor.setValue(data);
        compileOrRun();
      });
  }
}

function handleDemoDropdown() {
  const selectInput = document.getElementById("demo-select");

  selectInput.addEventListener("change", function () {
    loadDemo(this.value);
  });
}

export function restoreSelectedTargetFromURL()
{
  const urlParams = new URLSearchParams(window.location.search);
  const target = urlParams.get('target');
  if (target) {
    const targetSelect = document.getElementById("target-select");
    const profileSelect = document.getElementById("profile-select");
    targetSelect.value = target;
    updateProfileOptions(targetSelect, profileSelect);
  }  
}

export function restoreDemoSelectionFromURL()
{
  const urlParams = new URLSearchParams(window.location.search);
  var demo = urlParams.get('demo');
  if (demo) {
    if (!demo.endsWith(".slang"))
      demo += ".slang";
    const demoSelect = document.getElementById("demo-select");
    demoSelect.value = demo;
    loadDemo(demo);
    return true;
  }
  return false;
}

function loadDemoList()
{
  // Fill in demo-select dropdown using demoList.
  let demoDropdown = document.getElementById("demo-select");
  let firstOption = document.createElement("option");
  firstOption.value = "";
  firstOption.textContent = "Load Demo";
  firstOption.disabled = true;
  firstOption.selected = true;
  demoDropdown.appendChild(firstOption);

  // Create an option for each demo in the list.
  demoList.forEach((demo) => {
    let option = document.createElement("option");
    option.value = demo.url;
    option.textContent = demo.name;
    if (demo.name == "-")
    {
      option.disabled = true;
      option.textContent = "──────────";
    }
    demoDropdown.appendChild(option);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  var initShaderCode = "";
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  if (code) {
    decompressFromBase64URL(code).then((decompressed) => {
      initShaderCode = decompressed;
      loadEditor(false, "codeEditor", initShaderCode);
    });
  }
  else {
    loadEditor(false, "codeEditor", initShaderCode);
  }
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
    onDragStart: ()=>prepareForResize(),
    onDragEnd: ()=>{
        finishResizingTimeout = setTimeout(() => {
        finishResizing();
        finishResizingTimeout = null;
      }, 50);},
  });

  loadDemoList();
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

// Function to compress and decompress text, loading pako if necessary
async function compressToBase64URL(text:string) {
  // Compress the text
  const compressed = pako.deflate(text, { to: 'string' });
  const base64 = btoa(String.fromCharCode(...new Uint8Array(compressed)));

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decompressFromBase64URL(base64: string) {
  // Decode the base64 URL
  base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  const compressed = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  // Decompress the data
  const decompressed = pako.inflate(compressed, { to: 'string' });

  return decompressed;
}

function showTooltip(button: HTMLElement, text: string) {
  document.getElementById("tooltip").textContent = text;
  // Position the tooltip near the button
  const rect = button.getBoundingClientRect();
  tooltip.style.top = `${rect.bottom + window.scrollY + 15}px`;
  tooltip.style.left = `${rect.left + window.scrollX}px`;

  // Show the tooltip
  tooltip.classList.add('show');

  // Hide the tooltip after 3 seconds
  setTimeout(() => {
      tooltip.classList.remove('show');
  }, 3000);
}

var btnShareLink = document.getElementById("shareButton");
btnShareLink.onclick = async function () {
  if (!monacoEditor) return;
  try{
    const code = monacoEditor.getValue();
    const compressed = await compressToBase64URL(code);
    let url = new URL(window.location.href.split('?')[0]);
    const compileTarget = document.getElementById("target-select").value;
    url.searchParams.set("target", compileTarget)
    url.searchParams.set("code", compressed);
    navigator.clipboard.writeText(url.href);
    showTooltip(btnShareLink, "Link copied to clipboard.");
  }
  catch(e){
    showTooltip(btnShareLink, "Failed to copy link to clipboard.");
  }
};

function openTab(tabId: number)
{
  var buttons = [document.getElementById("btnTargetCode"), document.getElementById("btnReflection")];
  if (tabId == 0)
  {
    document.getElementById("codeGen").style = "";
    document.getElementById("reflectionTab").style.display = "none";
    
  }
  else
  {
    document.getElementById("codeGen").style.display = "none";
    document.getElementById("reflectionTab").style.display = "block";
    finishResizing();
  }
  for (var i = 0; i < buttons.length; i++)
  {
    if (i == tabId)
      buttons[i].classList.add("tabButtonActive");
    else
      buttons[i].classList.remove("tabButtonActive");
  }
}

document.addEventListener('keydown', function(event) {
  if (event.key === 'F5')
  {
      event.preventDefault();
      compileOrRun();
  }
  else if (event.ctrlKey && event.key === 'b')
  {
      event.preventDefault();
      // Your custom code here
      onCompile();
  }
});

var canvasLastMouseDownPos = {x:0, y:0};
export var canvasCurrentMousePos = {x:0, y:0};
var canvasIsMouseDown = false;
var canvasMouseClicked = false;
canvas.addEventListener("mousedown", function(event) {
  canvasLastMouseDownPos.x = event.offsetX;
  canvasLastMouseDownPos.y = event.offsetY;
  canvasCurrentMousePos.x = event.offsetX;
  canvasCurrentMousePos.y = event.offsetY;
  canvasMouseClicked = true;
  canvasIsMouseDown = true;
});

canvas.addEventListener("mousemove", function(event) {
  if (canvasIsMouseDown) {
    canvasCurrentMousePos.x = event.offsetX;
    canvasCurrentMousePos.y = event.offsetY;
  }
});
canvas.addEventListener("mouseup", function(event) {
  canvasIsMouseDown = false;
});
export function resetMouse()
{
  canvasIsMouseDown = false;
  canvasLastMouseDownPos.x = 0;
  canvasLastMouseDownPos.y = 0;
  canvasCurrentMousePos.x = 0;
  canvasCurrentMousePos.y = 0;
  canvasMouseClicked = false;
}