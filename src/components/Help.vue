<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'

defineProps<{
  compilerVersion: string
}>()

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
      <p v-if="compilerVersion">
        Slang compiler version: {{ compilerVersion }}
      </p>
      <h4>Compiling Shaders (the "Compile" button)</h4>
      <p>
        You can compile shaders to many targets supported by Slang here, including SPIR-V, HLSL, GLSL, Metal, CUDA, and
        WGSL.
        Generating DXIL requires DXC, which doesn't run in the browser so it's not supported here.
      </p>
      <h4>Run Shaders (the "Run" button)</h4>
      <p>
        In addition to compiling shaders, this playground can also run simple shaders via WebGPU.
        The playground supports running compute shaders that produce an image, text output, or both. All runnable shaders must be compute shaders marked with the <code>[shader("compute")]</code> attribute.
      </p>
      <h4>Print Shader</h4>
      To create a shader that prints text, you must <code>import printing;</code>. This module provides a <code>printf</code> function. The output will be displayed in the "Output" tab in the bottom panel. See the "Simple Print" demo for an example.
      <p>The <code>printing</code> module provides the following function:</p>
      <h4 class="doc-header"><code>void printf&lteach T&gt(String format, expand each T values) where T : IPrintf</code></h4>
      <p>Prints the values formatted according to the format.</p>
      <h4>Rendering Shader</h4>
      To create a shader that produces an image, you must <code>import rendering;</code>. This module provides an <code>outputTexture</code> and a <code>drawPixel</code> function. The output image will be displayed in the top right panel. See the "Circle" demo for an example.
      <p>The <code>rendering</code> module provides the following function:</p>
      <h4 class="doc-header"><code>void drawPixel(uint2 location, IFunc&lt;float4, int2&gt; renderFunction)</code></h4>
      <p>Calls the <code>renderFunction</code> to get a color for a given pixel and stores it in the output texture.</p>
      <h4>Shader Commands</h4>
      <p>WebGPU shaders in browser can use certain commands to specify how they will run. Requires <code>import playground;</code>.</p>
        <h4 class="doc-header"><code>[playground::ZEROS(512)]</code></h4>
        Initialize a buffer with zeros of the provided size.
        <h4 class="doc-header"><code>[playground::BLACK(512, 512)]</code></h4>
        Initialize a texture with zeros of the provided size.
        <h4 class="doc-header"><code>[playground::BLACK_3D(64, 64, 64)]</code></h4>
        Initialize a 3D texture with zeros of the provided size.
        <h4 class="doc-header"><code>[playground::BLACK_SCREEN(1.0, 1.0)]</code></h4>
        Initialize a texture with zeros with a size proportional to the screen size.
        <h4 class="doc-header"><code>[playground::SAMPLER]</code></h4>
        Initialize a sampler state with linear filtering and repeat address mode for sampling textures.
        <h4 class="doc-header"><code>[playground::URL("https://example.com/image.png")]</code></h4>
        Initialize a texture with image from URL.
        <h4 class="doc-header"><code>[playground::RAND(1000)]</code></h4>
        Initialize a <code>float</code> buffer with uniform random floats between 0 and 1.
        <h4 class="doc-header"><code>[playground::TIME]</code></h4>
        Gives a scalar uniform the current time in milliseconds.
        <h4 class="doc-header"><code>[playground::FRAME_ID]</code></h4>
        Gives a scalar uniform the current frame index (starting from 0).
        <h4 class="doc-header"><code>[playground::MOUSE_POSITION]</code></h4>
        Gives a 4 component vector uniform mouse data.
        <ul>
          <li><code>xy</code>: mouse position (in pixels) during last button down.</br></li>
          <li><code>abs(zw)</code>: mouse position during last button click.</br></li>
          <li><code>sign(mouze.z)</code>: button is down</br></li>
          <li><code>sign(mouze.w)</code>: button is clicked</br></li>
        </ul>
        <h4 class="doc-header"><code>[playground::KEY("KeyA")]</code></h4>
        Sets a scalar uniform to <code>1</code> if the specified key
        is pressed, <code>0</code> otherwise. Key name comes from either javascript <a href="https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code"><code>event.code</code></a> or <a href="https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key"><code>event.key</code></a>.
        <h4 class="doc-header"><code>[playground::SLIDER(0.3, 0.0, 1.0)]</code></h4>
        Control a <code>float</code> uniform with a provided default, minimum, and maximum.
        <h4 class="doc-header"><code>[playground::COLOR_PICK(0.5, 0.5, 0.5)]</code></h4>
        Control a <code>float3</code> color uniform with a provided default color.
        <h4 class="doc-header"><code>[playground::CALL::SIZE_OF("RESOURCE-NAME")]</code></h4>
        Dispatch a compute pass using the resource size to determine the work-group size.
        <h4 class="doc-header"><code>[playground::CALL(512, 512, 1)]</code></h4>
        Dispatch a compute pass with the given grid of threads.
        The number of work-groups will be determined by dividing by the number of threads per work-group and rounding up.
        <h4 class="doc-header"><code>[playground::CALL_INDIRECT("BUFFER-NAME", 0)]</code></h4>
        Dispatch a compute pass with an indirect command buffer and an offset in bytes.
        <h4 class="doc-header"><code>[playground::CALL::ONCE]</code></h4>
        Only dispatch the compute pass once at the start of rendering. Should be used in addition to another CALL command.
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
