import type { GenerationTask, GenerationTaskCreate, TaskListItem } from '@/types';
import api from './api';

/** 提交生成任务 */
export async function submitGeneration(
  payload: GenerationTaskCreate,
): Promise<GenerationTask> {
  const { data } = await api.post<GenerationTask>('/api/generate', payload);
  return data;
}

/** 获取单个任务详情 */
export async function fetchTask(taskId: number): Promise<GenerationTask> {
  const { data } = await api.get<GenerationTask>(`/api/tasks/${taskId}`);
  return data;
}

/** 获取任务列表 */
export async function fetchTasks(): Promise<TaskListItem[]> {
  const { data } = await api.get<TaskListItem[]>('/api/tasks');
  return data;
}

/** ControlNet 预处理预览 */
export async function previewControlNet(
  file: File,
  controlType: string,
): Promise<{ preview_url: string | null }> {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('control_type', controlType);

  const { data } = await api.post<{ preview_url: string | null }>(
    '/api/controlnet/preview',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    },
  );
  return data;
}
