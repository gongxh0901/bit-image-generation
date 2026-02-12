/** 风格类型 */
export type StyleType = 'ui' | 'vfx';

/** 风格实体 */
export interface Style {
  id: number;
  name: string;
  type: StyleType;
  lora_path: string | null;
  trigger_words: string | null;
  preview_image: string | null;
  created_at: string;
}

/** 创建风格请求 */
export interface StyleCreate {
  name: string;
  type: StyleType;
  lora_path?: string | null;
  trigger_words?: string | null;
  preview_image?: string | null;
}
