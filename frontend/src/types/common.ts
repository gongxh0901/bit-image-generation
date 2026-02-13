/** WebSocket 进度消息 */
export interface WSProgressMessage {
  kind: 'generation' | 'training' | 'remove_bg';
  id: number;
  status: string;
  progress?: number;
  current_frame?: number;
  total_frames?: number;
  frame_progress?: number;
  output_paths?: string[];
  timestamp?: string;
}

/** 任务列表项 */
export interface TaskListItem {
  id: number;
  task_kind: 'training' | 'generation' | 'remove_bg';
  status: string;
  created_at: string;
  progress?: number;
  output_paths?: string[];
}
