import axios from 'axios';

/** Axios 实例 - 自动检测后端地址 */
const api = axios.create({
  baseURL: '',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 响应拦截器 - 统一错误处理
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message ||
      '请求失败';
    console.error('[API Error]', message);
    return Promise.reject(new Error(message));
  },
);

export default api;
