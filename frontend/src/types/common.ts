/** WebSocket 进度消息 */
export interface WSProgressMessage {
  kind: 'generation' | 'training';
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
  task_kind: 'training' | 'generation';
  status: string;
  created_at: string;
  progress?: number;
  output_paths?: string[];
}
