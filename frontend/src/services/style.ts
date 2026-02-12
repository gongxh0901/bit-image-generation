import type { Style, StyleCreate } from '@/types';
import api from './api';

/** 风格更新请求 */
export interface StyleUpdatePayload {
  name?: string;
  type?: 'ui' | 'vfx';
  trigger_words?: string | null;
  preview_image?: string | null;
}

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

/** 更新风格 */
export async function updateStyle(id: number, payload: StyleUpdatePayload): Promise<Style> {
  const { data } = await api.put<Style>(`/api/styles/${id}`, payload);
  return data;
}

/** 删除风格 */
export async function deleteStyle(id: number): Promise<void> {
  await api.delete(`/api/styles/${id}`);
}
