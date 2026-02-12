import type { TaskListItem } from '@/types';
import api from './api';

/** 获取所有任务列表（训练 + 生成） */
export async function fetchTasks(): Promise<TaskListItem[]> {
  const { data } = await api.get<TaskListItem[]>('/api/tasks');
  return data;
}
