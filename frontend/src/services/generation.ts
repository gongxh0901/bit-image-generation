import type { GenerationTask, GenerationTaskCreate, TaskListItem } from '@/types';
import api from './api';

/** 提交生成任务 */
export async function submitGeneration(
  payload: GenerationTaskCreate,
): Promise<GenerationTask> {
  const { data } = await api.post<GenerationTask>('/api/generate', payload);
  return data;
}

/** 获取任务列表 */
export async function fetchTasks(): Promise<TaskListItem[]> {
  const { data } = await api.get<TaskListItem[]>('/api/tasks');
  return data;
}
