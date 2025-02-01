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
      <p>WebGPU shaders in browser can use certain commands to specify how they will run.</p>
      <ul>
        <li><code>[playground::ZEROS(512)]</code></li>
        Initialize a float buffer with zeros of the provided size.
        <li><code>[playground::BLACK(512, 512)]</code></li>
        Initialize a float texture with zeros of the provided size.
        <li><code>[playground::URL("https://example.com/image.png")]</code></li>
        Initialize a texture with image from URL.
        <li><code>[playground::RAND(1000)]</code></li>
        Initialize a float buffer with uniform random floats between 0 and 1.
        <li><code>//! CALL(fn-name, SIZE_OF(RESOURCE-NAME))</code></li>
        Dispatch a compute pass with the given function name and using the resource size to determine the work-group
        size.
        <li><code>//! CALL(fn-name, 512, 512)</code></li>
      </ul>
      <p>Dispatch a compute pass with the given function name and the provided work-group size.</p>
      <h4>Playground functions</h4>
      <p>By importing the playground shader you gain access to a few helpful functions.</p>
      <ul>
        <li><code>float4 getMousePosition()</code></li>
        <code>xy</code>: mouse position (in pixels) during last button down.</br>
        <code>abs(zw)</code>: mouse position during last button click.</br>
        <code>sign(mouze.z)</code>: button is down</br>
        <code>sign(mouze.w)</code>: button is clicked</br>
        <li><code>float getTime()</code></li>
        Returns the current time in milliseconds.
        <li><code>void printf&lteach T&gt(String format, expand each T values) where T : IPrintf</code></li>
        Prints the values formatted according to the format. Only available in print shaders.
      </ul>
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
  max-width: 500px;
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
</style>