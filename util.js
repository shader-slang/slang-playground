function configContext(device, canvas) {
  let context = canvas.getContext("webgpu");

  const canvasConfig = {
    device: device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  };

  context.configure(canvasConfig);
  return context;
}

function createOutputTexture(device, width, height, format) {
  const textureDesc = {
    label: "output storage texture",
    size: { width: width, height: height },
    format: format,
    usage:
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING,
  };

  let storageTexture = device.createTexture(textureDesc);
  return storageTexture;
}
