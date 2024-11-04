
var passThroughshaderCode = `

      struct VertexShaderOutput {
        @builtin(position) position: vec4f,
        @location(0) texcoord: vec2f,
      };

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> VertexShaderOutput {
        let uv = array(
          // 1st triangle
          vec2f( 0.0,  0.0),  // center
          vec2f( 1.0,  0.0),  // right, center
          vec2f( 0.0,  1.0),  // center, top

          // 2st triangle
          vec2f( 0.0,  1.0),  // center, top
          vec2f( 1.0,  0.0),  // right, center
          vec2f( 1.0,  1.0),  // right, top
        );

        let pos = array(
          // 1st triangle
          vec2f( -1.0,  -1.0),  // center
          vec2f( 1.0,  -1.0),  // right, center
          vec2f( -1.0,  1.0),  // center, top

          // 2st triangle
          vec2f( -1.0,  1.0),  // center, top
          vec2f( 1.0,  -1.0),  // right, center
          vec2f( 1.0,  1.0),  // right, top
        );

        var vsOutput: VertexShaderOutput;
        let xy = pos[vertexIndex];
        vsOutput.position = vec4f(xy, 0.0, 1.0);
        vsOutput.texcoord = uv[vertexIndex];
        return vsOutput;
      }

      @group(0) @binding(0) var ourSampler: sampler;
      @group(0) @binding(1) var ourTexture: texture_2d<f32>;

      @fragment fn fs(fsInput: VertexShaderOutput) -> @location(0) vec4f {
          let color = textureSample(ourTexture, ourSampler, fsInput.texcoord);
          let value = u32(color.x);
          let r = ((value & 0xFF000000) >> 24);
          let g = ((value & 0x00FF0000) >> 16);
          let b = ((value & 0x0000FF00) >> 8);

          return vec4f(f32(r)/255.0f, f32(g)/255.0f, f32(b)/255.0f, 1.0f);
      }
`;

class GraphicsPipeline
{
    vertShader;
    fragShader;
    device;
    pipeline;
    sampler;
    pipelineLayout;

    constructor(device)
    {
        this.device = device;
    }

    createGraphicsPipelineLayout()
    {
        // Passthrough shader will need an input texture to be displayed on the screen
        const bindGroupLayoutDescriptor = {
            label: 'pass through pipeline bind group layout',
            entries: [
                {binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {}},
                {binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: 'float'}},
            ],
        };

        const bindGroupLayout = device.createBindGroupLayout(bindGroupLayoutDescriptor);
        const layout = device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]});
        this.pipelineLayout = layout;
    }

    createPipeline(shaderModule, inputTexture)
    {
        this.createGraphicsPipelineLayout();

        const pipeline = device.createRenderPipeline({
            label: 'pass through pipeline',
            layout: this.pipelineLayout,
            vertex:
            {
              module: shaderModule
            },
            fragment:
            {
              module: shaderModule,
              targets: [{format: navigator.gpu.getPreferredCanvasFormat()}]
            },
            });
        this.pipeline = pipeline;

        this.sampler = device.createSampler();
        this.inputTexture = inputTexture;
        this.createBindGroup();
    }

    createBindGroup()
    {
        const bindGroup = device.createBindGroup({
          label: 'pass through pipeline bind group',
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.inputTexture.createView() },
          ],
        });

        this.bindGroup = bindGroup;
    }

    createRenderPassDesc()
    {
        const renderPassDescriptor = {
          label: 'pass through renderPass',
          colorAttachments: [
            {
              // view: <- to be filled out when we render
              clearValue: [0.3, 0.3, 0.3, 1],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        };

        return renderPassDescriptor;
    }
};
