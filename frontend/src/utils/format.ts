/**
 * 格式化日期时间
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * 获取状态对应的中文标签和颜色
 */
export function getStatusInfo(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    queued: { label: '排队中', color: 'default' },
    running: { label: '进行中', color: 'processing' },
    completed: { label: '已完成', color: 'success' },
    partial: { label: '部分完成', color: 'warning' },
    failed: { label: '失败', color: 'error' },
  };
  return map[status] ?? { label: status, color: 'default' };
}
