import type { TrainingJob, TrainingJobCreate } from '@/types';
import api from './api';

/** 提交训练任务 */
export async function submitTraining(
  payload: TrainingJobCreate,
): Promise<TrainingJob> {
  const { data } = await api.post<TrainingJob>('/api/training', payload);
  return data;
}

/** 获取训练任务详情 */
export async function fetchTrainingJob(jobId: number): Promise<TrainingJob> {
  const { data } = await api.get<TrainingJob>(`/api/training/${jobId}`);
  return data;
}
