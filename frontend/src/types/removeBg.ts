/** 抠图任务实体 */
export interface RemoveBgTask {
  id: number;
  input_image: string;
  output_image: string | null;
  model: 'birefnet' | 'birefnet-hr';
  status: 'queued' | 'running' | 'completed' | 'failed';
  source_task_id: number | null;
  created_at: string;
  completed_at: string | null;
}

/** 创建抠图任务请求 */
export interface RemoveBgTaskCreate {
  input_image: string;
  model?: 'birefnet' | 'birefnet-hr';
  source_task_id?: number | null;
}
