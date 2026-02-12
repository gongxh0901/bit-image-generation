import api from './api';

/** 上传结果 */
export interface UploadResult {
  url: string;
  filename: string;
}

/** 上传参考图片 */
export async function uploadImage(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const { data } = await api.post<UploadResult>('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000, // 上传可能较慢
  });
  return data;
}
