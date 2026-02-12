/** 生成任务类型 */
export type GenerationType = 'txt2img' | 'img2img';

/** 生成任务状态 */
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

/** 生成任务实体 */
export interface GenerationTask {
  id: number;
  style_id: number | null;
  type: GenerationType;
  prompt: string;
  input_image: string | null;
  status: TaskStatus;
  output_paths: string[];
  created_at: string;
}

/** 创建生成任务请求 */
export interface GenerationTaskCreate {
  style_id?: number | null;
  type: GenerationType;
  prompt: string;
  input_image?: string | null;
}

/** 生成结果（用于前端展示） */
export interface GenerationResult {
  id: string;
  taskId: number;
  imageUrl: string;
  filename: string;
  createdAt: string;
}
