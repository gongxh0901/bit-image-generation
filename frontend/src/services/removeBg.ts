import type { RemoveBgTask, RemoveBgTaskCreate } from '@/types';
import api from './api';

/** 提交抠图任务 */
export async function submitRemoveBg(
  payload: RemoveBgTaskCreate,
): Promise<RemoveBgTask> {
  const { data } = await api.post<RemoveBgTask>('/api/remove-bg', payload);
  return data;
}

/** 获取抠图任务详情 */
export async function fetchRemoveBgTask(taskId: number): Promise<RemoveBgTask> {
  const { data } = await api.get<RemoveBgTask>(`/api/remove-bg/${taskId}`);
  return data;
}
