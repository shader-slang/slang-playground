<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'

const showHelp = ref(false)
const fullscreenModal = useTemplateRef("fullscreenModal")

function openHelp() {
  showHelp.value = true
}

function handleScreenClick(event: Event) {
  // Check if the click target is the same as the parent element
  if (event.target === fullscreenModal.value) {
    showHelp.value = false
  }
}

defineExpose({
  openHelp,
})

</script>

<template>
  <div id="helpModal" class="modal" v-show="showHelp" @click="handleScreenClick" ref="fullscreenModal">
    <div class="modal-content">
      <span class="close" @click="showHelp = false">&times;</span>
      <h3>Slang Playground</h3>
      <p>
        Welcome to Slang Playground. Here you can write, compile and run Slang shaders locally within your browser.
        The Slang compiler runs locally in your browser and no data is sent to any server.
      </p>
      <h4>Compiling Shaders (the "Compile" button)</h4>
      <p>
        You can compile shaders to many targets supported by Slang here, including SPIR-V, HLSL, GLSL, Metal, and
        WGSL.
        Generating DXIL requires DXC, which doesn't run in the browser so it's not supported here.
      </p>
      <h4>Run Shaders (the "Run" button)</h4>
      <p>
        In addition to compiling shaders, this playground can also run simple shaders via WebGPU.
        The playground supports running two types of shaders:
      </p>
      <ul>
        <li><b>Image Compute Shader</b>: This is a compute shader that returns a pixel value at a given image
          coordinate, similar to ShaderToys.
          An image compute shader must define a imageMain function, see the "Circle" demo for an example.</li>
        <li><b>Print Shader</b>: This is a shader that prints text to the text output window.
          A print shader must define a printMain function, see the "Simple Print" demo for an example.</li>
      </ul>
      <h4>Shader Commands</h4>
      <p>WebGPU shaders in browser can use certain commands to specify how they will run. Requires <code>import playground;</code>.</p>
        <h4 class="doc-header"><code>[playground::ZEROS(512)]</code></h4>
        Initialize a <code>float</code> buffer with zeros of the provided size.
        <h4 class="doc-header"><code>[playground::BLACK(512, 512)]</code></h4>
        Initialize a <code>float</code> texture with zeros of the provided size.
        <h4 class="doc-header"><code>[playground::URL("https://example.com/image.png")]</code></h4>
        Initialize a texture with image from URL.
        <h4 class="doc-header"><code>[playground::RAND(1000)]</code></h4>
        Initialize a <code>float</code> buffer with uniform random floats between 0 and 1.
        <h4 class="doc-header"><code>[playground::TIME]</code></h4>
        Gives a <code>float</code> uniform the current time in milliseconds.
        <h4 class="doc-header"><code>[playground::MOUSE_POSITION]</code></h4>
        Gives a <code>float4</code> uniform mouse data.
        <ul>
          <li><code>xy</code>: mouse position (in pixels) during last button down.</br></li>
          <li><code>abs(zw)</code>: mouse position during last button click.</br></li>
          <li><code>sign(mouze.z)</code>: button is down</br></li>
          <li><code>sign(mouze.w)</code>: button is clicked</br></li>
        </ul>
        <h4 class="doc-header"><code>[playground::SLIDER(0.3, 0.0, 1.0)]</code></h4>
        Control a <code>float</code> uniform with a provided default, minimum, and maximum.
        <h4 class="doc-header"><code>[playground::COLOR_PICK(0.5, 0.5, 0.5)]</code></h4>
        Control a <code>float3</code> color uniform with a provided default color.
        <h4 class="doc-header"><code>//! CALL(fn-name, SIZE_OF(RESOURCE-NAME))</code></h4>
        Dispatch a compute pass with the given function name and using the resource size to determine the work-group
        size.
        <h4 class="doc-header"><code>//! CALL(fn-name, 512, 512)</code></h4>
      <p>Dispatch a compute pass with the given function name and the provided work-group size.</p>
      <h4>Playground functions</h4>
      <p>The playground shader also provides the following functions:</p>
      <h4 class="doc-header"><code>void printf&lteach T&gt(String format, expand each T values) where T : IPrintf</code></h4>
      Prints the values formatted according to the format. Only available in print shaders.
    </div>
  </div>
</template>

<style scoped>
.modal {
  position: fixed;
  z-index: 999;
  /* Sit on top of code editor*/
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
}

.modal-content {
  background-color: #fff;
  margin: auto;
  padding: 20px;
  border-radius: 10px;
  width: 80%;
  max-width: 600px;
  max-height: 100%;
  overflow-y: auto;
}

.close {
  color: #aaa;
  float: right;
  font-size: 28px;
  font-weight: bold;
}

.close:hover,
.close:focus {
  color: #000;
  text-decoration: none;
  cursor: pointer;
}

.doc-header {
  margin-bottom: 0.5em;
}
</style>