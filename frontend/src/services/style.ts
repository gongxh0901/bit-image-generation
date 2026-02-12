import type { Style, StyleCreate } from '@/types';
import api from './api';

/** 获取所有风格列表 */
export async function fetchStyles(): Promise<Style[]> {
  const { data } = await api.get<Style[]>('/api/styles');
  return data;
}

/** 创建新风格 */
export async function createStyle(payload: StyleCreate): Promise<Style> {
  const { data } = await api.post<Style>('/api/styles', payload);
  return data;
}
