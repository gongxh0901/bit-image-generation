/** 生成任务类型 */
export type GenerationType = 'txt2img' | 'img2img';

/** 生成任务状态 */
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';

/** ControlNet 配置（Flux.1 ControlNet Union） */
export interface ControlNetConfig {
  enabled: boolean;
  type: 'canny' | 'depth' | 'tile' | 'blur' | 'pose';
  image: string | null;
  strength: number;
}

/** 生成任务实体 */
export interface GenerationTask {
  id: number;
  style_id: number | null;
  type: GenerationType;
  prompt: string;
  negative_prompt: string;
  input_image: string | null;
  seed: number | null;
  batch_size: number;
  controlnet_config: ControlNetConfig | null;
  status: TaskStatus;
  output_paths: string[];
  created_at: string;
}

/** 创建生成任务请求 */
export interface GenerationTaskCreate {
  style_id?: number | null;
  type: GenerationType;
  prompt: string;
  negative_prompt?: string;
  input_image?: string | null;
  seed?: number | null;
  batch_size?: number;
  controlnet?: ControlNetConfig | null;
}

/** 生成结果（用于前端展示） */
export interface GenerationResult {
  id: string;
  taskId: number;
  imageUrl: string;
  filename: string;
  createdAt: string;
}
