import { create } from 'zustand';
import type { TaskListItem } from '@/types';
import { fetchTasks } from '@/services/task';

interface TaskStore {
  /** 任务列表 */
  tasks: TaskListItem[];
  /** 加载中 */
  loading: boolean;
  /** 错误 */
  error: string | null;
  /** 筛选条件 */
  filter: {
    kind: 'all' | 'training' | 'generation' | 'remove_bg';
    status: 'all' | 'queued' | 'running' | 'completed' | 'failed';
  };

  // Actions
  fetchTasks: () => Promise<void>;
  setFilter: (filter: Partial<TaskStore['filter']>) => void;
  clearError: () => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  loading: false,
  error: null,
  filter: { kind: 'all', status: 'all' },

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await fetchTasks();
      set({ tasks, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  setFilter: (filter) => {
    set((s) => ({ filter: { ...s.filter, ...filter } }));
  },

  clearError: () => set({ error: null }),
}));
