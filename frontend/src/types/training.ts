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

/** 训练参数 */
export interface TrainingParams {
  batch_size: number;
  learning_rate: number;
  max_train_steps: number;
  resolution: number;
  save_every_n_steps?: number;
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
  batch_size: {
    label: '批次大小',
    hint: '每步训练使用的图片数量，建议 1-4',
    min: 1,
    max: 8,
    step: 1,
    default: 1,
  },
  learning_rate: {
    label: '学习率',
    hint: '控制模型更新速度，默认 0.0001',
    min: 0.00001,
    max: 0.01,
    step: 0.00001,
    default: 0.0001,
  },
  max_train_steps: {
    label: '训练步数',
    hint: '训练总轮次，建议 1000-3000',
    min: 100,
    max: 10000,
    step: 100,
    default: 1000,
  },
  resolution: {
    label: '分辨率',
    hint: '图片训练尺寸，SDXL 推荐 1024',
    min: 512,
    max: 2048,
    step: 128,
    default: 1024,
  },
  save_every_n_steps: {
    label: '保存间隔',
    hint: '每隔多少步保存一次模型检查点',
    min: 100,
    max: 5000,
    step: 100,
    default: 500,
  },
};
