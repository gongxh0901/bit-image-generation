/** 训练任务状态 */
export type TrainingStatus = 'queued' | 'running' | 'completed' | 'failed';

/** 训练任务实体 */
export interface TrainingJob {
  id: number;
  style_id: number | null;
  dataset_path: string;
  status: TrainingStatus;
  params: TrainingParams;
  progress: number;
  output_lora_path: string | null;
  created_at: string;
}

/** MFlux 训练参数 */
export interface TrainingParams {
  lora_rank: number;
  learning_rate: number;
  steps: number;
}

/** 创建训练任务请求 */
export interface TrainingJobCreate {
  style_name: string;
  style_type: 'ui' | 'vfx';
  dataset_path: string;
  params: TrainingParams;
}

/** 训练参数字段描述（用于表单提示） */
export const TRAINING_PARAM_HINTS: Record<keyof TrainingParams, { label: string; hint: string; min?: number; max?: number; step?: number; default: number }> = {
  lora_rank: {
    label: 'LoRA Rank',
    hint: 'LoRA 维度，值越大容量越大但越慢，建议 8-32',
    min: 4,
    max: 64,
    step: 4,
    default: 16,
  },
  learning_rate: {
    label: '学习率',
    hint: '控制模型更新速度，默认 0.0001',
    min: 0.00001,
    max: 0.01,
    step: 0.00001,
    default: 0.0001,
  },
  steps: {
    label: '训练步数',
    hint: '训练总步数，建议 500-3000',
    min: 100,
    max: 10000,
    step: 100,
    default: 1000,
  },
};
