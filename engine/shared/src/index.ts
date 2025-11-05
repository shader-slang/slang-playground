import { ScalarType, UniformController } from './playgroundInterface';

export * from './playgroundInterface';

export function isControllerRendered(controller: UniformController) {
    return controller.type == "SLIDER" || controller.type == "COLOR_PICK";
}

export function getScalarSize(scalarType: ScalarType): 8 | 16 | 32 | 64 {
    let size = parseInt(scalarType.replace(/^[a-z]*/, ""));
    return size as any;
}