import { TemplateConfig } from '../types';
import { classicTemplate } from './classic';
import { minimalTemplate } from './minimal';
import { modernTemplate } from './modern';

export const templates: Record<string, TemplateConfig> = {
  modern: modernTemplate,
  classic: classicTemplate,
  minimal: minimalTemplate,
};

