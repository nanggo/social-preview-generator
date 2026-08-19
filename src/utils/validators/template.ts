import { ErrorType, PreviewGeneratorError, type TemplateConfig } from '../../types';
import { sanitizeControlChars } from './text';
import { validateColor } from './color';

function invalid(message: string): never {
  throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, message);
}

function asPlainObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') invalid(`${fieldName} must be a plain object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${fieldName} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function optionalEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    invalid(`${fieldName} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function finiteNumber(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
  options: { required?: boolean; integer?: boolean } = {}
): number | undefined {
  if (value === undefined && !options.required) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (options.integer && !Number.isInteger(value))
  ) {
    invalid(`${fieldName} must be ${options.integer ? 'an integer' : 'a finite number'} from ${min} to ${max}`);
  }
  return value;
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid(`${fieldName} must be a boolean`);
  return value;
}

function safeFontWeight(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(`${fieldName} must be a string`);
  if (['normal', 'bold', 'bolder', 'lighter'].includes(value)) return value;
  if (!/^\d{1,4}$/.test(value)) invalid(`${fieldName} contains an unsafe CSS token`);
  const numericWeight = Number(value);
  if (numericWeight < 1 || numericWeight > 1000) invalid(`${fieldName} must be from 1 to 1000`);
  return String(numericWeight);
}

function typographyEntry(
  value: unknown,
  fieldName: string,
  options: { required: boolean; allowLineSettings: boolean }
) {
  if (value === undefined && !options.required) return undefined;
  const entry = asPlainObject(value, fieldName);
  return {
    ...entry,
    fontSize: finiteNumber(entry.fontSize, `${fieldName}.fontSize`, 1, 512, { required: true })!,
    fontWeight: safeFontWeight(entry.fontWeight, `${fieldName}.fontWeight`),
    ...(options.allowLineSettings
      ? {
          lineHeight: finiteNumber(entry.lineHeight, `${fieldName}.lineHeight`, 0.5, 4),
          maxLines: finiteNumber(entry.maxLines, `${fieldName}.maxLines`, 1, 20, { integer: true }),
        }
      : {}),
  };
}

function safeGradientDirection(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid('template.effects.gradient.direction must be a string');
  const angle = /^-?(?:\d+|\d*\.\d+)(?:deg|grad|rad|turn)$/;
  const direction = /^to (?:(?:left|right)(?: (?:top|bottom))?|(?:top|bottom)(?: (?:left|right))?)$/;
  if (value.length > 32) invalid('template.effects.gradient.direction is too long');
  if (!angle.test(value) && !direction.test(value)) {
    invalid('template.effects.gradient.direction is invalid');
  }
  return value;
}

export function validateTemplateConfig(input: TemplateConfig): TemplateConfig {
  const template = asPlainObject(input, 'template');
  if (typeof template.name !== 'string') invalid('template.name must be a string');
  const name = sanitizeControlChars(template.name).trim();
  if (name.length === 0 || name.length > 128) {
    invalid('template.name must contain 1 to 128 characters');
  }

  const layout = asPlainObject(template.layout, 'template.layout');
  const typography = asPlainObject(template.typography, 'template.typography');

  let effects: TemplateConfig['effects'];
  if (template.effects !== undefined) {
    const rawEffects = asPlainObject(template.effects, 'template.effects');
    let gradient: NonNullable<TemplateConfig['effects']>['gradient'];
    if (rawEffects.gradient !== undefined) {
      const rawGradient = asPlainObject(rawEffects.gradient, 'template.effects.gradient');
      if (rawGradient.type === undefined) {
        invalid('template.effects.gradient.type is required');
      }
      if (!Array.isArray(rawGradient.colors) || rawGradient.colors.length > 16) {
        invalid('template.effects.gradient.colors must contain at most 16 colors');
      }
      gradient = {
        ...rawGradient,
        type: optionalEnum(rawGradient.type, 'template.effects.gradient.type', ['linear', 'radial', 'none'] as const)!,
        colors: rawGradient.colors.map((color, index) => {
          if (typeof color !== 'string') invalid(`template.effects.gradient.colors[${index}] must be a string`);
          return validateColor(color);
        }),
        direction: safeGradientDirection(rawGradient.direction),
        opacity: finiteNumber(rawGradient.opacity, 'template.effects.gradient.opacity', 0, 1),
      };
    }

    let blur: NonNullable<TemplateConfig['effects']>['blur'];
    if (rawEffects.blur !== undefined) {
      const rawBlur = asPlainObject(rawEffects.blur, 'template.effects.blur');
      blur = {
        ...rawBlur,
        radius: finiteNumber(rawBlur.radius, 'template.effects.blur.radius', 0, 100, { required: true })!,
        areas: optionalEnum(rawBlur.areas, 'template.effects.blur.areas', ['background', 'overlay', 'all', 'none'] as const),
      };
    }

    let shadow: NonNullable<TemplateConfig['effects']>['shadow'];
    if (rawEffects.shadow !== undefined) {
      const rawShadow = asPlainObject(rawEffects.shadow, 'template.effects.shadow');
      shadow = {
        ...rawShadow,
        text: optionalBoolean(rawShadow.text, 'template.effects.shadow.text'),
        box: optionalBoolean(rawShadow.box, 'template.effects.shadow.box'),
      };
    }

    effects = {
      ...rawEffects,
      gradient,
      blur,
      shadow,
      borderRadius: finiteNumber(rawEffects.borderRadius, 'template.effects.borderRadius', 0, 4096),
    };
  }

  let imageProcessing: TemplateConfig['imageProcessing'];
  if (template.imageProcessing !== undefined) {
    const rawImage = asPlainObject(template.imageProcessing, 'template.imageProcessing');
    imageProcessing = {
      ...rawImage,
      brightness: finiteNumber(rawImage.brightness, 'template.imageProcessing.brightness', 0, 1),
      blur: finiteNumber(rawImage.blur, 'template.imageProcessing.blur', 0, 100),
      contrast: finiteNumber(rawImage.contrast, 'template.imageProcessing.contrast', 0, 2),
      saturation: finiteNumber(rawImage.saturation, 'template.imageProcessing.saturation', 0, 2),
      requiresTransparentCanvas: optionalBoolean(
        rawImage.requiresTransparentCanvas,
        'template.imageProcessing.requiresTransparentCanvas'
      ),
    };
  }

  if (template.overlayGenerator !== undefined && typeof template.overlayGenerator !== 'function') {
    invalid('template.overlayGenerator must be a function');
  }

  return {
    ...template,
    name,
    layout: {
      ...layout,
      padding: finiteNumber(layout.padding, 'template.layout.padding', 0, 2048, { required: true })!,
      titlePosition: optionalEnum(layout.titlePosition, 'template.layout.titlePosition', ['top', 'center', 'bottom', 'left', 'right'] as const),
      descriptionPosition: optionalEnum(layout.descriptionPosition, 'template.layout.descriptionPosition', ['below-title', 'bottom', 'none'] as const),
      imagePosition: optionalEnum(layout.imagePosition, 'template.layout.imagePosition', ['background', 'left', 'right', 'top', 'none'] as const),
      logoPosition: optionalEnum(layout.logoPosition, 'template.layout.logoPosition', ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'bottom-center', 'none'] as const),
    },
    typography: {
      ...typography,
      title: typographyEntry(typography.title, 'template.typography.title', { required: true, allowLineSettings: true })!,
      description: typographyEntry(typography.description, 'template.typography.description', { required: false, allowLineSettings: true }),
      siteName: typographyEntry(typography.siteName, 'template.typography.siteName', { required: false, allowLineSettings: false }),
    },
    effects,
    imageProcessing,
    overlayGenerator: template.overlayGenerator as TemplateConfig['overlayGenerator'],
  };
}
